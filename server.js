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
const RECONNECT_DELAY = 3000;

function getVietnamTime() {
    const now = new Date();
    const utc7 = new Date(now.getTime() + (7 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60000));
    return utc7.toISOString().replace('T', ' ').substring(0, 19) + " UTC+7";
}

// Khởi tạo các tham số mặc định an toàn
let WS_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
let ACTIVE_USER = "GM_quapotjz";
let EXPIRE_TIME = 1780029354479;
let REFRESH_TOKEN = "";
let endpointType = "wsbinary"; 

try {
    const filePath = path.join(__dirname, 'token.txt');
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('websocket')) {
            endpointType = 'websocket';
        }
        const jsonMatch = content.match(/\{[^{}]*"ipAddress"[^{}]*\}/);
        if (jsonMatch) {
            const parsedData = JSON.parse(jsonMatch[0]);
            WS_TOKEN = parsedData.wsToken || WS_TOKEN;
            ACTIVE_USER = parsedData.username || ACTIVE_USER;
            EXPIRE_TIME = parsedData.timestamp || EXPIRE_TIME;
            REFRESH_TOKEN = parsedData.refreshToken || REFRESH_TOKEN;
            console.log(`[✅] Đọc thành công token.txt của user: ${ACTIVE_USER}`);
        }
    } else {
        console.log("[⚠️] Không tìm thấy token.txt, sử dụng cấu hình mặc định.");
    }
} catch (e) {
    console.log(`[⚠️] Lỗi đọc file token.txt nhưng vẫn bỏ qua để chạy tiếp: ${e.message}`);
}

const WEBSOCKET_URL = `wss://websocket.azhkthg1.net/${endpointType}?token=${WS_TOKEN}`;
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
            "info": {}
        }
    ],
    [6, "MiniGame", "taixiuPlugin", { "cmd": 1005 }],
    [6, "MiniGame", "lobbyPlugin", { "cmd": 10001 }]
];

function connectWebsocket() {
    console.log(`[🔄] ĐANG KẾT NỐI ĐẾN: ${WEBSOCKET_URL}`);
    
    const options = {
        headers: WS_HEADERS,
        handshakeTimeout: 15000
    };

    // Tự động kiểm tra và thêm proxy an toàn nếu có cấu hình biến môi trường
    if (process.env.PROXY_URL) {
        try {
            const { HttpsProxyAgent } = require('https-proxy-agent');
            options.agent = new HttpsProxyAgent(process.env.PROXY_URL);
            console.log(`[🌐] Đang chạy qua Proxy: ${process.env.PROXY_URL}`);
        } catch (err) {
            console.log(`[❌] Lỗi nạp thư viện proxy: ${err.message}`);
        }
    }

    wsConnection = new WebSocket(WEBSOCKET_URL, options);

    wsConnection.on('open', () => {
        console.log("[🚀] WEBSOCKET ĐÃ THÔNG LUỒNG...");
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
                    console.log(`[🎮] PHIÊN MỚI: ${sid}`);
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

                    console.log(`[🎲] PHIÊN ${currentResult.phien}: ${total} (${result})`);
                    currentSessionId = null;
                }
            }
        } catch (e) {}
    });

    wsConnection.on('close', (code) => {
        console.log(`[❌] SOCKET ĐÓNG (Code: ${code}). Đang kết nối lại...`);
        setTimeout(connectWebsocket, RECONNECT_DELAY);
    });

    wsConnection.on('error', (err) => {
        console.log(`[❌] LỖI SOCKET: ${err.message}`);
    });
}

connectWebsocket();

app.get('/api/tx', (req, res) => {
    res.json(currentResult);
});

app.get('/', (req, res) => {
    res.json({
        "name": "SunWin Streamer Node Safe V5",
        "status": "Running",
        "time": getVietnamTime()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 API Live tại: http://localhost:${PORT}/api/tx`);
});
