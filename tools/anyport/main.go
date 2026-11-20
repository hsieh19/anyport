package main

import (
	"bytes"
	"embed"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed all:dist
var distFS embed.FS

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
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.Mutex

	udpConn *net.UDPConn
)

func main() {
	port := flag.Int("port", 8081, "Local HTTP & WebSocket server port")
	udpPort := flag.Int("udp", 47808, "Local UDP port to listen for BACnet")
	autoOpen := flag.Bool("open", true, "Automatically open browser at startup")
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

	// 2. 协程：循环读取 UDP 数据包并广播给所有 WS 客户端
	go readUDPAndBroadcast()

	// 3. 配置 HTTP 路由：/ws、/proxy 以及内嵌的前端静态资源 SPA 服务
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", handleWebSocket)
	mux.HandleFunc("/proxy", handleHttpProxy)

	// 挂载嵌入的前端静态资源
	feFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Fatalf("Failed to load embedded frontend: %v", err)
	}
	mux.Handle("/", spaHandler(feFS))

	serverAddr := fmt.Sprintf("127.0.0.1:%d", *port)
	url := fmt.Sprintf("http://%s", serverAddr)

	fmt.Println("=============================================================")
	fmt.Println("              Anyport - 多协议工业调试平台                   ")
	fmt.Println("=============================================================")
	fmt.Printf(" 服务地址: %s\n", url)
	fmt.Printf(" 网桥服务: ws://%s/ws\n", serverAddr)
	fmt.Printf(" UDP 监听: 0.0.0.0:%d\n", *udpPort)
	fmt.Println(" 按 Ctrl+C 退出程序")
	fmt.Println("=============================================================")

	// 4. 自动打开浏览器
	if *autoOpen {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openBrowser(url)
		}()
	}

	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", *port))
	if err != nil {
		log.Fatalf("Failed to listen on port %d: %v", *port, err)
	}
	log.Fatal(http.Serve(listener, mux))
}

// spaHandler 处理 SPA 单页应用路由：如果静态资源存在则直接返回，否则返回 index.html
func spaHandler(fSys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fSys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// 检查静态文件是否存在
		f, err := fSys.Open(path)
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// 文件不存在时 fallback 到 index.html (支持 SPA 历史路由)
		indexFile, err := fSys.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer indexFile.Close()

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.Copy(w, indexFile)
	})
}

func handleHttpProxy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Target-Url")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	targetUrl := r.URL.Query().Get("url")
	if targetUrl == "" {
		targetUrl = r.Header.Get("X-Target-Url")
	}
	if !strings.HasPrefix(targetUrl, "http://") && !strings.HasPrefix(targetUrl, "https://") {
		http.Error(w, `{"ok":false,"error":"invalid_target_url"}`, http.StatusBadRequest)
		return
	}

	var bodyBytes []byte
	if r.Body != nil {
		bodyBytes, _ = io.ReadAll(r.Body)
		_ = r.Body.Close()
	}

	req, err := http.NewRequest(r.Method, targetUrl, bytes.NewReader(bodyBytes))
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"ok":false,"error":%q}`, err.Error()), http.StatusBadGateway)
		return
	}
	req.ContentLength = int64(len(bodyBytes))
	if ct := r.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"ok":false,"error":%q}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WS Upgrade error: %v", err)
		return
	}
	defer conn.Close()

	sessionConns := make(map[string]net.Conn)
	var sessionMu sync.Mutex

	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	defer func() {
		clientsMu.Lock()
		delete(clients, conn)
		clientsMu.Unlock()

		sessionMu.Lock()
		for _, tConn := range sessionConns {
			tConn.Close()
		}
		sessionMu.Unlock()
	}()

	for {
		_, msgData, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg Message
		if err := json.Unmarshal(msgData, &msg); err != nil {
			continue
		}

		if msg.Type == "probe" {
			timeout := 3 * time.Second
			var pErr error
			if msg.Protocol == "tcp" {
				d := &net.Dialer{Timeout: timeout}
				tConn, dErr := d.Dial("tcp", msg.Target)
				if dErr == nil {
					tConn.Close()
				}
				pErr = dErr
			} else {
				_, pErr = net.ResolveUDPAddr("udp", msg.Target)
			}

			status := "ok"
			errMsg := ""
			if pErr != nil {
				status = "error"
				errMsg = pErr.Error()
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
			if msg.Protocol == "" && msg.Target != "" {
				_, portStr, _ := net.SplitHostPort(msg.Target)
				if portStr == "502" || portStr == "503" || portStr == "5020" {
					isTcp = true
				}
			}

			if isTcp {
				sessionMu.Lock()
				tConn, exists := sessionConns[msg.Target]
				if !exists {
					tConn, err = net.DialTimeout("tcp", msg.Target, 3*time.Second)
					if err != nil {
						sessionMu.Unlock()
						errResp, _ := json.Marshal(Message{Type: "rx", Target: msg.Target, Payload: "ERROR: " + err.Error()})
						conn.WriteMessage(websocket.TextMessage, errResp)
						continue
					}
					sessionConns[msg.Target] = tConn
					go handleTCPRead(tConn, conn, msg.Target)
				}
				sessionMu.Unlock()

				tConn.SetWriteDeadline(time.Now().Add(2 * time.Second))
				_, err = tConn.Write(data)
				if err != nil {
					tConn.Close()
					sessionMu.Lock()
					delete(sessionConns, msg.Target)
					sessionMu.Unlock()
				}
			} else {
				targetAddr, _ := net.ResolveUDPAddr("udp", msg.Target)
				if targetAddr != nil {
					udpConn.WriteToUDP(data, targetAddr)
				}
			}
		}
	}
}

func handleTCPRead(tcpConn net.Conn, wsConn *websocket.Conn, target string) {
	defer tcpConn.Close()

	buf := make([]byte, 2048)
	for {
		tcpConn.SetReadDeadline(time.Now().Add(15 * time.Second))
		n, err := tcpConn.Read(buf)
		if err != nil {
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
			return
		}
	}
}

func readUDPAndBroadcast() {
	buf := make([]byte, 2048)
	for {
		n, addr, err := udpConn.ReadFromUDP(buf)
		if err != nil {
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
				client.Close()
				delete(clients, client)
			}
		}
		clientsMu.Unlock()
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("自动打开浏览器失败，请手动访问: %s (原因: %v)", url, err)
	}
}
