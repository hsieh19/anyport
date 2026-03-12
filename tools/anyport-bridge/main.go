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

	"github.com/gorilla/websocket"
)

// Message 协议结构
type Message struct {
	Type    string `json:"type"`    // "tx" or "rx"
	Target  string `json:"target"`  // Device IP:Port
	Payload string `json:"payload"` // Hex string
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
)

func main() {
	wsPort := flag.Int("ws", 8081, "WebSocket server port")
	udpPort := flag.Int("udp", 47808, "Local UDP port to listen")
	flag.Parse()

	// 1. 初始化 UDP 监听
	addr, err := net.ResolveUDPAddr("udp", fmt.Sprintf(":%d", *udpPort))
	if err != nil {
		log.Fatalf("Failed to resolve UDP addr: %v", err)
	}

	udpConn, err = net.ListenUDP("udp", addr)
	if err != nil {
		log.Fatalf("Failed to listen UDP: %v", err)
	}
	defer udpConn.Close()

	log.Printf("Anyport BACnet Bridge started.")
	log.Printf("WebSocket: ws://127.0.0.1:%d", *wsPort)
	log.Printf("UDP: 0.0.0.0:%d", *udpPort)

	// 2. 协程：循环读取 UDP 数据包并分发给所有 WS 客户端
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

	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	log.Printf("New client connected: %s", conn.RemoteAddr())

	defer func() {
		clientsMu.Lock()
		delete(clients, conn)
		clientsMu.Unlock()
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

		if msg.Type == "tx" {
			data, err := hex.DecodeString(msg.Payload)
			if err != nil {
				log.Printf("Hex decode error: %v", err)
				continue
			}

			targetAddr, err := net.ResolveUDPAddr("udp", msg.Target)
			if err != nil {
				log.Printf("Target resolve error: %v", err)
				continue
			}

			_, err = udpConn.WriteToUDP(data, targetAddr)
			if err != nil {
				log.Printf("UDP Write error: %v", err)
			} else {
				log.Printf("Forwarded TX to %s: %s", targetAddr, msg.Payload)
			}
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
		log.Printf("Received RX from %s: %s", addr, payload)

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
