const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 1234;

let currentResult = {
    "phien": null,
    "xuc_xac_1": null,
    "xuc_xac_2": null,
    "xuc_xac_3": null,
    "tong": null,
    "ket_qua": "",
    "thoi_gian": ""
};

let currentSessionId = null;
let wsConnection = null;
const RECONNECT_DELAY = 2500;

function getVietnamTime() {
    const now = new Date();
    const utc7 = new Date(now.getTime() + (7 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60000));
    return utc7.toISOString().replace('T', ' ').substring(0, 19) + " UTC+7";
}

// Hàm giải mã token.txt thông minh theo cấu trúc gói tin nhị phân của ông
function loadTokenFromFile() {
    try {
        const filePath = path.join(__dirname, 'token.txt');
        if (!fs.existsSync(filePath)) {
            console.log("[❌] Không tìm thấy file token.txt!");
            return null;
        }

        const content = fs.readFileSync(filePath, 'utf8');
        
        // Quét tìm trực tiếp khối JSON chứa ipAddress và wsToken
        const jsonMatch = content.match(/\{[^{}]*"ipAddress"[^{}]*\}/);
        if (jsonMatch) {
            const parsedData = JSON.parse(jsonMatch[0]);
            console.log(`[✅] Đã đồng bộ Token thành công của User: ${parsedData.username || 'Hệ thống'}`);
            return parsedData;
        }
        return null;
    } catch (error) {
        console.log(`[❌] Lỗi xử lý đọc file token.txt: ${error.message}`);
        return null;
    }
}

const TOKEN_DATA = loadTokenFromFile();

let WS_TOKEN = "";
let ACTIVE_USER = "GM_quapotjz";
let EXPIRE_TIME = 1780029354479;
let REFRESH_TOKEN = "";

if (TOKEN_DATA) {
    WS_TOKEN = TOKEN_DATA.wsToken || "";
    ACTIVE_USER = TOKEN_DATA.username || "GM_quapotjz";
    EXPIRE_TIME = TOKEN_DATA.timestamp || 1780029354479;
    REFRESH_TOKEN = TOKEN_DATA.refreshToken || "";
}

// Endpoint động (Hỗ trợ cả /websocket hoặc /wsbinary tùy thuộc thiết bị của ông)
const WEBSOCKET_URL = `wss://websocket.azhkthg1.net/websocket?token=${WS_TOKEN}`;

const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_11 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6.1 Mobile/15E148 Safari/604.1",
    "Origin": "https://play.sun.pw"
};

const initialMessages = [
    [
        1,
        "MiniGame",
        ACTIVE_USER,
        "quapit",
        {
            "signature": "05915B436159B8F4E4DFF537639BD014D54EBEFA18CF62A8EB205B4074010AD72AEA9A780D5A8A4E1BD59BBBAFE03902C594B5DA56FD60D099F1FDDCCD48385FCC2760B5B0B4B8E75D39B8E40DF8CB7C01EA58DBEDA32805927473AB71FA9B798B0C2EDC445C3E36E47EF0AAFAD45601D99AAD1EC642FD2B63573A0401D6EC69",
            "expireIn": EXPIRE_TIME,
            "wsToken": WS_TOKEN,
            "accessToken": "7e9a9ecbff1b4a6393b48346f6d8b709",
            "message": "Thành công",
            "refreshToken": REFRESH_TOKEN,
            "info": TOKEN_DATA || {}
        }
    ],
    [6, "MiniGame", "taixiuPlugin", { "cmd": 1005 }],
    [6, "MiniGame", "lobbyPlugin", { "cmd": 10001 }]
];

function connectWebsocket() {
    console.log("[🔄] Đang mở kết nối WebSocket...");

    wsConnection = new WebSocket(WEBSOCKET_URL, {
        headers: WS_HEADERS,
        handshakeTimeout: 15000
    });

    wsConnection.on('open', () => {
        console.log("[✅] WebSocket Connected!");
        
        initialMessages.forEach((msg, index) => {
            setTimeout(() => {
                if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
                    wsConnection.send(JSON.stringify(msg));
                }
            }, index * 600);
        });
    });

    wsConnection.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString('utf8'));
            if (!Array.isArray(data) || data.length < 2) return;

            if (typeof data[1] === 'object' && data[1] !== null) {
                const { cmd, sid, d1, d2, d3, gBB } = data[1];

                if (cmd === 1008 && sid) {
                    currentSessionId = sid;
                    console.log(`[🎮] Mã phiên mới: ${sid}`);
                }

                if (cmd === 1003 && gBB) {
                    if (d1 === undefined || d2 === undefined || d3 === undefined) return;

                    const total = d1 + d2 + d3;
                    const result = total > 10 ? "Tài" : "Xỉu";

                    currentResult = {
                        "phien": currentSessionId,
                        "xuc_xac_1": d1,
                        "xuc_xac_2": d2,
                        "xuc_xac_3": d3,
                        "tong": total,
                        "ket_qua": result,
                        "thoi_gian": getVietnamTime()
                    };

                    console.log(`[🎲] Kết quả phiên ${currentResult.phien}: ${total} (${result})`);
                    currentSessionId = null;
                }
            }
        } catch (e) {}
    });

    wsConnection.on('close', (code) => {
        console.log(`[❌] Socket đóng (Code: ${code}). Đang kết nối lại...`);
        setTimeout(connectWebsocket, RECONNECT_DELAY);
    });

    wsConnection.on('error', (err) => {
        console.log(`[❌] Lỗi kết nối socket: ${err.message}`);
    });
}

app.get('/api/tx', (req, res) => {
    res.json(currentResult);
});

app.get('/', (req, res) => {
    res.json({
        "name": "SunWin Streamer Node V2",
        "status": "Running",
        "user": ACTIVE_USER,
        "time": getVietnamTime()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Cổng API đang mở tại /api/tx thông qua Port: ${PORT}`);
    connectWebsocket();
});
