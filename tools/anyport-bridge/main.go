package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Message 协议结构
type Message struct {
	Type     string `json:"type"`     // "tx", "rx", "probe", "probe_res"
	Protocol string `json:"protocol"` // "udp", "tcp"
	Target   string `json:"target"`   // Device IP:Port
	Payload  string `json:"payload"`  // Hex string or target info
	Id       string `json:"id"`       // Request tracking ID
}

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	// 动态管理客户端
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.Mutex

	// UDP 全局监听端口 (BACnet 默认 47808)
	udpConn *net.UDPConn

	// TCP 连接管理: 每个 WS 客户端连接映射到各自的 TCP 连接池
	tcpConns   = make(map[string]net.Conn)
	tcpConnsMu sync.Mutex
)

func main() {
	wsPort := flag.Int("ws", 8081, "WebSocket server port")
	udpPort := flag.Int("udp", 47808, "Local UDP port to listen")
	flag.Parse()

	// 1. 初始化 UDP 监听 (BACnet/IP 基础)
	addr, err := net.ResolveUDPAddr("udp", fmt.Sprintf(":%d", *udpPort))
	if err != nil {
		log.Fatalf("Failed to resolve UDP addr: %v", err)
	}

	udpConn, err = net.ListenUDP("udp", addr)
	if err != nil {
		log.Fatalf("Failed to listen UDP: %v", err)
	}
	defer udpConn.Close()

	log.Printf("Anyport Multi-Protocol Bridge started.")
	log.Printf("WebSocket: ws://127.0.0.1:%d/ws", *wsPort)
	log.Printf("UDP Global: 0.0.0.0:%d", *udpPort)

	// 2. 协程：循环读取 UDP 数据包并分发给所有 WS 客户端 (BACnet 广播模式)
	go readUDPAndBroadcast()

	// 3. 启动 WebSocket 服务器
	http.HandleFunc("/ws", handleWebSocket)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", *wsPort), nil))
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WS Upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// 核心改进：每个 WebSocket 会话私有的 TCP 连接池
	sessionConns := make(map[string]net.Conn)
	var sessionMu sync.Mutex

	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	log.Printf("New client connected: %s", conn.RemoteAddr())

	// 清理逻辑：会话断开时，关闭所有由此会话产生的 TCP 连接
	defer func() {
		clientsMu.Lock()
		delete(clients, conn)
		clientsMu.Unlock()

		sessionMu.Lock()
		for target, tConn := range sessionConns {
			log.Printf("Closing session TCP connection to %s", target)
			tConn.Close()
		}
		sessionMu.Unlock()

		log.Printf("Client disconnected: %s", conn.RemoteAddr())
	}()

	for {
		_, msgData, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg Message
		if err := json.Unmarshal(msgData, &msg); err != nil {
			log.Printf("JSON unmarshal error: %v", err)
			continue
		}

		if msg.Type == "probe" {
			log.Printf("Probing target: %s [%s]", msg.Target, msg.Protocol)
			timeout := 3 * time.Second
			var err error
			if msg.Protocol == "tcp" {
				// 手动控制 Dialer 属性，确切捕获 Refused 信号
				d := &net.Dialer{Timeout: timeout}
				tConn, dErr := d.Dial("tcp", msg.Target)
				if dErr == nil {
					tConn.Close()
				}
				err = dErr
			} else {
				_, err = net.ResolveUDPAddr("udp", msg.Target)
			}

			status := "ok"
			errMsg := ""
			if err != nil {
				status = "error"
				errMsg = err.Error()
				log.Printf("Probe FINISHED for %s: %v", msg.Target, err)
			} else {
				log.Printf("Probe SUCCESS for %s", msg.Target)
			}
			resp := map[string]interface{}{
				"type":    "probe_res",
				"id":      msg.Id,
				"target":  msg.Target,
				"status":  status,
				"message": errMsg,
			}
			respData, _ := json.Marshal(resp)
			conn.WriteMessage(websocket.TextMessage, respData)
			continue
		}

		if msg.Type == "tx" {
			data, err := hex.DecodeString(msg.Payload)
			if err != nil {
				continue
			}

			isTcp := msg.Protocol == "tcp"
			if msg.Protocol == "" {
				if msg.Target != "" {
					_, portStr, _ := net.SplitHostPort(msg.Target)
					if portStr == "502" || portStr == "503" || portStr == "5020" {
						isTcp = true
					}
				}
			}

			if isTcp {
				sessionMu.Lock()
				tConn, exists := sessionConns[msg.Target]
				if !exists {
					log.Printf("[%s] Dialing NEW TCP target: %s", conn.RemoteAddr(), msg.Target)
					tConn, err = net.DialTimeout("tcp", msg.Target, 3*time.Second)
					if err != nil {
						sessionMu.Unlock()
						log.Printf("TCP Dial error: %v", err)
						errResp, _ := json.Marshal(Message{Type: "rx", Target: msg.Target, Payload: "ERROR: " + err.Error()})
						conn.WriteMessage(websocket.TextMessage, errResp)
						continue
					}
					sessionConns[msg.Target] = tConn
					go handleTCPRead(tConn, conn, msg.Target)
				}
				sessionMu.Unlock()

				// 设置写死限，防止缓冲区堵塞
				tConn.SetWriteDeadline(time.Now().Add(2 * time.Second))
				_, err = tConn.Write(data)
				if err != nil {
					log.Printf("TCP Write error: %v", err)
					tConn.Close()
					sessionMu.Lock()
					delete(sessionConns, msg.Target)
					sessionMu.Unlock()
				} else {
					log.Printf("Forwarded TCP TX to %s (len=%d)", msg.Target, len(data))
				}
			} else {
				targetAddr, _ := net.ResolveUDPAddr("udp", msg.Target)
				if targetAddr != nil {
					udpConn.WriteToUDP(data, targetAddr)
					log.Printf("Forwarded UDP TX to %s (len=%d)", msg.Target, len(data))
				}
			}
		}
	}
}

func handleTCPRead(tcpConn net.Conn, wsConn *websocket.Conn, target string) {
	defer func() {
		tcpConn.Close()
		log.Printf("[Reader] Routine stopped for %s", target)
	}()

	buf := make([]byte, 2048)
	for {
		// 设置读取死限 (15秒无数据则断开，防挂死)
		tcpConn.SetReadDeadline(time.Now().Add(15 * time.Second))
		n, err := tcpConn.Read(buf)
		if err != nil {
			// 如果是正常的超时，若连接仍有效则继续（这里根据 Modbus 离散性质，直接退出并清理更好）
			log.Printf("TCP Read error from %s: %v", target, err)
			errResp, _ := json.Marshal(Message{
				Type:     "rx",
				Protocol: "tcp",
				Target:   target,
				Payload:  "ERROR: " + err.Error(),
			})
			wsConn.WriteMessage(websocket.TextMessage, errResp)
			return
		}

		payload := hex.EncodeToString(buf[:n])
		resp := Message{
			Type:     "rx",
			Protocol: "tcp",
			Target:   target,
			Payload:  payload,
		}
		respData, _ := json.Marshal(resp)
		if err := wsConn.WriteMessage(websocket.TextMessage, respData); err != nil {
			log.Printf("WS response write failed: %v", err)
			return // WS 挂了，读取也该退了
		}
	}
}

func readUDPAndBroadcast() {
	buf := make([]byte, 2048)
	for {
		n, addr, err := udpConn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("UDP Read error: %v", err)
			continue
		}

		payload := hex.EncodeToString(buf[:n])
		resp := Message{
			Type:    "rx",
			Target:  addr.String(),
			Payload: payload,
		}

		respData, _ := json.Marshal(resp)

		clientsMu.Lock()
		for client := range clients {
			err := client.WriteMessage(websocket.TextMessage, respData)
			if err != nil {
				log.Printf("WS Write error: %v", err)
				client.Close()
				delete(clients, client)
			}
		}
		clientsMu.Unlock()
	}
}
