package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var epoch = time.Now()

func nowMs() float64 { return float64(time.Since(epoch).Microseconds()) / 1000 }

type Client struct {
	id     string
	name   string
	color  string
	car    string
	joined int
	conn   *websocket.Conn
	send   chan *websocket.PreparedMessage
	room   *Room // nil while browsing the room list
	state  json.RawMessage
	bounty int
	fin    float64
}

// Room is one game: its creator alone controls it, others join only while it is in the lobby, and the creator can
// kick players (who then can't rejoin that room). The room closes when its creator leaves.
type Room struct {
	srv     *Hub
	id      string
	name    string
	hostID  string
	clients map[string]*Client
	banned  map[string]bool
	phase   string // lobby | race | results
	mode    string // race | pursuit
	laps    int
	traffic bool
	mapID   string
	startAt float64
	seed    int
	grid    map[string]int
	results []map[string]any
}

type Hub struct {
	mu       sync.Mutex
	clients  map[string]*Client
	rooms    map[string]*Room
	nextID   int
	nextRoom int
}

func newHub() *Hub {
	return &Hub{clients: map[string]*Client{}, rooms: map[string]*Room{}}
}

// prepare encodes a message once; with per-message compression it is also compressed only once, however many
// players it goes to.
func prepare(v any) *websocket.PreparedMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	pm, err := websocket.NewPreparedMessage(websocket.TextMessage, b)
	if err != nil {
		return nil
	}
	return pm
}

func (h *Hub) sendTo(c *Client, v any) { sendAll(map[string]*Client{c.id: c}, v) }

func sendAll(cs map[string]*Client, v any) {
	if len(cs) == 0 {
		return
	}
	pm := prepare(v)
	if pm == nil {
		return
	}
	for _, c := range cs {
		select {
		case c.send <- pm:
		default: // slow client: drop rather than stall the room
		}
	}
}

// browsing: everyone not in a room (they share the room list and a lobby-wide chat).
func (h *Hub) browsing() map[string]*Client {
	out := map[string]*Client{}
	for id, c := range h.clients {
		if c.room == nil {
			out[id] = c
		}
	}
	return out
}

func (h *Hub) roomsMsg() map[string]any {
	rs := []*Room{}
	for _, r := range h.rooms {
		rs = append(rs, r)
	}
	sort.Slice(rs, func(i, j int) bool { return rs[i].id < rs[j].id })
	out := []map[string]any{}
	for _, r := range rs {
		host := ""
		if c := r.clients[r.hostID]; c != nil {
			host = c.name
		}
		out = append(out, map[string]any{"id": r.id, "name": r.name, "host": host, "players": len(r.clients),
			"phase": r.phase, "map": r.mapID, "mode": r.mode})
	}
	return map[string]any{"t": "rooms", "rooms": out, "online": len(h.clients)}
}

func (h *Hub) broadcastRooms() { sendAll(h.browsing(), h.roomsMsg()) }

func (h *Hub) createRoom(c *Client, name string) {
	h.leaveRoom(c, "")
	if name = strings.TrimSpace(name); name == "" {
		name = c.name + "'s room"
	}
	if len(name) > 24 {
		name = name[:24]
	}
	h.nextRoom++
	r := &Room{srv: h, id: fmt.Sprintf("r%d", h.nextRoom), name: name, hostID: c.id, clients: map[string]*Client{}, banned: map[string]bool{},
		phase: "lobby", mode: "race", laps: 3, traffic: true, mapID: "bengaluru"}
	h.rooms[r.id] = r
	h.joinRoom(c, r)
}

func (h *Hub) joinRoom(c *Client, r *Room) {
	if c.room == r {
		return
	}
	h.leaveRoom(c, "")
	c.room = r
	c.state, c.fin, c.bounty = nil, 0, 0
	r.clients[c.id] = c
	r.broadcast(r.lobbyMsg())
	h.broadcastRooms()
}

// leaveRoom takes c out of its room; reason ("left", "kicked", "closed") is sent to c, empty sends nothing.
func (h *Hub) leaveRoom(c *Client, reason string) {
	r := c.room
	if r == nil {
		return
	}
	delete(r.clients, c.id)
	c.room = nil
	c.state = nil
	if reason != "" {
		h.sendTo(c, map[string]any{"t": "left", "reason": reason, "room": r.name})
	}
	r.broadcast(map[string]any{"t": "leave", "id": c.id})
	if c.id == r.hostID { // only the creator runs the room: close it for everyone
		for _, o := range r.clients {
			o.room, o.state = nil, nil
			h.sendTo(o, map[string]any{"t": "left", "reason": "closed", "room": r.name})
		}
		r.clients = map[string]*Client{}
	}
	if len(r.clients) == 0 {
		delete(h.rooms, r.id)
	} else {
		r.checkAllFinished()
		r.broadcast(r.lobbyMsg())
	}
	h.broadcastRooms()
}

func (r *Room) broadcast(v any) { sendAll(r.clients, v) }

func (r *Room) sortedClients() []*Client {
	cs := make([]*Client, 0, len(r.clients))
	for _, c := range r.clients {
		cs = append(cs, c)
	}
	sort.Slice(cs, func(i, j int) bool { return cs[i].joined < cs[j].joined })
	return cs
}

func (r *Room) lobbyMsg() map[string]any {
	ps := []map[string]any{}
	for _, c := range r.sortedClients() {
		ps = append(ps, map[string]any{"id": c.id, "name": c.name, "color": c.color, "car": c.car})
	}
	return map[string]any{"t": "lobby", "room": map[string]any{"id": r.id, "name": r.name}, "players": ps, "host": r.hostID, "phase": r.phase,
		"mode": r.mode, "laps": r.laps, "traffic": r.traffic, "map": r.mapID}
}

func (r *Room) startMsg() map[string]any {
	return map[string]any{"t": "start", "mode": r.mode, "laps": r.laps, "traffic": r.traffic, "map": r.mapID,
		"startAt": r.startAt, "grid": r.grid, "seed": r.seed}
}

func (r *Room) startRace() {
	r.phase = "race"
	r.startAt = nowMs() + 4500
	r.seed = int(time.Now().UnixNano() % 100000)
	r.grid = map[string]int{}
	r.results = nil
	for i, c := range r.sortedClients() {
		r.grid[c.id] = i
		c.fin = 0
		c.bounty = 0
		c.state = nil
	}
	r.broadcast(r.startMsg())
	r.broadcast(r.lobbyMsg())
	r.srv.broadcastRooms()
}

func (r *Room) finishRace() {
	if r.phase != "race" {
		return
	}
	r.phase = "results"
	cs := r.sortedClients()
	if r.mode == "race" {
		sort.SliceStable(cs, func(i, j int) bool {
			a, b := cs[i].fin, cs[j].fin
			if a == 0 {
				return false
			}
			return b == 0 || a < b
		})
	} else {
		sort.SliceStable(cs, func(i, j int) bool { return cs[i].bounty > cs[j].bounty })
	}
	r.results = []map[string]any{}
	for _, c := range cs {
		r.results = append(r.results, map[string]any{"id": c.id, "name": c.name, "color": c.color, "time": c.fin, "bounty": c.bounty})
	}
	r.broadcast(map[string]any{"t": "result", "mode": r.mode, "order": r.results})
	r.broadcast(r.lobbyMsg())
	r.srv.broadcastRooms()
}

func (r *Room) checkAllFinished() {
	if r.mode != "race" || r.phase != "race" {
		return
	}
	done := 0
	for _, c := range r.clients {
		if c.fin > 0 {
			done++
		}
	}
	if done == len(r.clients) {
		r.finishRace()
		return
	}
	if done == 1 {
		seed := r.seed
		go func() {
			time.Sleep(30 * time.Second)
			r.srv.mu.Lock()
			defer r.srv.mu.Unlock()
			if r.phase == "race" && r.seed == seed {
				r.finishRace()
			}
		}()
	}
}

type inMsg struct {
	T       string          `json:"t"`
	Name    string          `json:"name"`
	Color   string          `json:"color"`
	Car     string          `json:"car"`
	Map     string          `json:"map"`
	Mode    string          `json:"mode"`
	Laps    int             `json:"laps"`
	Traffic *bool           `json:"traffic"`
	C       float64         `json:"c"`
	Time    float64         `json:"time"`
	S       json.RawMessage `json:"s"`
	K       json.RawMessage `json:"k"`
	Text    string          `json:"text"`
	Room    string          `json:"room"`
	ID      string          `json:"id"`
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }, EnableCompression: true}

func (h *Hub) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	h.mu.Lock()
	h.nextID++
	c := &Client{id: fmt.Sprintf("p%d", h.nextID), name: fmt.Sprintf("Racer %d", h.nextID), color: "#c00000", car: "ferrari",
		joined: h.nextID, conn: conn, send: make(chan *websocket.PreparedMessage, 128)}
	h.clients[c.id] = c
	h.sendTo(c, map[string]any{"t": "welcome", "id": c.id, "now": nowMs()})
	h.broadcastRooms()
	h.mu.Unlock()

	go func() {
		for pm := range c.send {
			conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
			if err := conn.WritePreparedMessage(pm); err != nil {
				conn.Close()
				return
			}
		}
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var m inMsg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		h.handle(c, &m)
	}

	h.mu.Lock()
	h.leaveRoom(c, "")
	delete(h.clients, c.id)
	close(c.send)
	h.broadcastRooms()
	h.mu.Unlock()
	conn.Close()
}

func (h *Hub) handle(c *Client, m *inMsg) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := c.room
	isHost := r != nil && c.id == r.hostID
	switch m.T {
	case "ping":
		h.sendTo(c, map[string]any{"t": "pong", "c": m.C, "now": nowMs()})
	case "chat":
		txt := strings.TrimSpace(m.Text)
		if txt == "" {
			return
		}
		if len(txt) > 200 {
			txt = txt[:200]
		}
		to := h.browsing()
		if r != nil {
			to = r.clients
		}
		sendAll(to, map[string]any{"t": "chat", "from": c.id, "name": c.name, "color": c.color, "text": txt, "at": nowMs()})
	case "hello":
		if n := strings.TrimSpace(m.Name); n != "" {
			if len(n) > 16 {
				n = n[:16]
			}
			c.name = n
		}
		if len(m.Color) == 7 && m.Color[0] == '#' {
			c.color = m.Color
		}
		if m.Car != "" && len(m.Car) <= 16 {
			c.car = m.Car
		}
		if r != nil {
			r.broadcast(r.lobbyMsg())
		}
		h.broadcastRooms()
	case "rooms":
		h.sendTo(c, h.roomsMsg())
	case "create":
		h.createRoom(c, m.Name)
	case "join":
		t := h.rooms[m.Room]
		switch {
		case t == nil:
			h.sendTo(c, map[string]any{"t": "err", "text": "That room no longer exists."})
		case t.banned[c.id]:
			h.sendTo(c, map[string]any{"t": "err", "text": "You were kicked from " + t.name + "."})
		case t.phase != "lobby":
			h.sendTo(c, map[string]any{"t": "err", "text": t.name + " has already started. Join once it's back in the lobby."})
		default:
			h.joinRoom(c, t)
		}
	case "leave":
		h.leaveRoom(c, "left")
	case "kick":
		if t := h.clients[m.ID]; isHost && t != nil && t.room == r && t != c {
			r.banned[t.id] = true
			h.leaveRoom(t, "kicked")
		}
	case "cfg":
		if !isHost || r.phase == "race" {
			return
		}
		if m.Mode == "race" || m.Mode == "pursuit" {
			r.mode = m.Mode
		}
		if m.Laps >= 1 && m.Laps <= 10 {
			r.laps = m.Laps
		}
		if m.Traffic != nil {
			r.traffic = *m.Traffic
		}
		if validID(m.Map) {
			r.mapID = m.Map
		}
		r.broadcast(r.lobbyMsg())
		h.broadcastRooms()
	case "start":
		if isHost && r.phase != "race" {
			r.startRace()
		}
	case "end":
		if isHost {
			if r.phase == "race" {
				r.finishRace()
			} else {
				r.phase = "lobby"
				r.broadcast(r.lobbyMsg())
				h.broadcastRooms()
			}
		}
	case "s":
		if r == nil {
			return
		}
		c.state = m.S
		var s []json.RawMessage // compact state array; index 11 is the pursuit bounty
		if json.Unmarshal(m.S, &s) == nil && len(s) > 11 {
			json.Unmarshal(s[11], &c.bounty)
		}
	case "knock":
		if r == nil {
			return
		}
		others := map[string]*Client{}
		for id, o := range r.clients {
			if id != c.id {
				others[id] = o
			}
		}
		sendAll(others, map[string]any{"t": "knock", "k": m.K})
	case "fin":
		if r != nil && r.phase == "race" && c.fin == 0 && m.Time > 0 {
			c.fin = m.Time
			r.broadcast(map[string]any{"t": "fin", "id": c.id, "time": m.Time})
			r.checkAllFinished()
		}
	}
}

func (h *Hub) snapshotLoop(ctx context.Context) {
	t := time.NewTicker(50 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.mu.Lock()
			for _, r := range h.rooms {
				ps := make([]map[string]any, 0, len(r.clients))
				for _, c := range r.clients {
					if c.state != nil {
						ps = append(ps, map[string]any{"id": c.id, "s": c.state})
					}
				}
				if len(ps) > 0 { // nobody driving (lobby): nothing to send
					r.broadcast(map[string]any{"t": "snap", "now": nowMs(), "p": ps})
				}
			}
			h.mu.Unlock()
		}
	}
}

func validID(s string) bool {
	if s == "" || len(s) > 24 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}

