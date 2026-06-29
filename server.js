const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 1234;

// Biến lưu kết quả toàn cục
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
const PING_INTERVAL = 15000;

// Hàm lấy thời gian Việt Nam (UTC+7)
function getVietnamTime() {
    const now = new Date();
    const utc7 = new Date(now.getTime() + (7 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60000));
    return utc7.toISOString().replace('T', ' ').substring(0, 19) + " UTC+7";
}

// Hàm tự động quét và bóc tách dữ liệu JSON sạch từ file token.txt chứa ký tự lạ
function loadTokenFromFile() {
    try {
        const filePath = path.join(__dirname, 'token.txt');
        if (!fs.existsSync(filePath)) {
            console.log("[❌] Không tìm thấy file token.txt trong thư mục!");
            return null;
        }

        const content = fs.readFileSync(filePath, 'utf8');
        if (!content.trim()) {
            console.log("[❌] File token.txt đang trống rỗng!");
            return null;
        }

        // Dùng Regex quét tìm đoạn JSON chứa ipAddress hoặc wsToken bất kể ký tự lạ bao quanh
        const jsonMatch = content.match(/\{[^{}]*"wsToken"[^{}]*\}/);
        if (jsonMatch) {
            const parsedData = JSON.parse(jsonMatch[0]);
            console.log("[✅] Đã đọc và đồng bộ cấu hình từ token.txt thành công.");
            return parsedData;
        }

        return null;
    } catch (error) {
        console.log(`[❌] Lỗi khi xử lý đọc file token.txt: ${error.message}`);
        return null;
    }
}

// Tiến hành khởi tạo dữ liệu Token ban đầu
const TOKEN_DATA = loadTokenFromFile();

let WS_TOKEN = "";
let ACTIVE_USER = "SC_hoangz2280";
let EXPIRE_TIME = 1782656896638;
let REFRESH_TOKEN = "";

if (TOKEN_DATA) {
    WS_TOKEN = TOKEN_DATA.wsToken || "";
    ACTIVE_USER = TOKEN_DATA.username || "SC_hoangz2280";
    EXPIRE_TIME = TOKEN_DATA.timestamp || 1782656896638;
    REFRESH_TOKEN = TOKEN_DATA.refreshToken || "";
} else {
    console.log("[⚠️] Áp dụng token dự phòng mặc định...");
    WS_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJ2aXBnYW1lIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzQ4NzIwNTA0LCJhZmZJZCI6IjI3OTc1NmNmMjMwODQ1ODU5ZGJkNzljODZkYzkzNDVlIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJzdW4ud2luIiwiZW1haWwiOiIiLCJ0aW1lc3RhbXAiOjE3ODI2NTY4OTY2MzgsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjQwMjo4MDA6NjFkNzpkNTkyOjc4NzE6MTgyYTpmMGJkOmVmYmEiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzA3LnBuZyIsInBsYXRmb3JtSWQiOjQsInVzZXJJZCI6Ijg5NTMwM2I0LTgwMzMtNDYzNC04OGUwLWU0ZWQyZmM2Yjg2YyIsImVtYWlsVmVyaWZpZWQiOm51bGwsInJlZ1RpbWUiOjE3Nzk3MTcwOTM3NTcsInBob25lIjoiIiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ1_hoGFuZzIyODAifQ.laROx8f6ZBgvr5xH5HVeG0-paEhzHFRzT0lW-k-XXQI";
}

// Cấu hình URL và Header đúng chuẩn thiết bị di động iOS/Safari theo app của ông
const WEBSOCKET_URL = `wss://websocket.azhkthg1.net/wsbinary?token=${WS_TOKEN}`;
const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_11 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6.1 Mobile/15E148 Safari/604.1",
    "Origin": "https://play.sun.pw"
};

// Mảng tin nhắn bắt tay khởi tạo đồng bộ phiên
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
    console.log("[🔄] Đang mở luồng kết nối WebSocket iOS Safari...");

    wsConnection = new WebSocket(WEBSOCKET_URL, {
        headers: WS_HEADERS,
        handshakeTimeout: 10000
    });

    wsConnection.on('open', () => {
        console.log("[✅] Đã thiết lập kết nối stream đến cổng wsbinary máy chủ!");
        
        // Gửi loạt gói tin bắt tay tuần tự
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
            // Chuyển đổi định dạng nếu nhận dữ liệu buffer nhị phân
            const msgString = message.toString('utf8');
            const data = JSON.parse(msgString);

            if (!Array.isArray(data) || data.length < 2) return;

            if (typeof data[1] === 'object' && data[1] !== null) {
                const { cmd, sid, d1, d2, d3, gBB } = data[1];

                if (cmd === 1008 && sid) {
                    currentSessionId = sid;
                    console.log(`[🎮] Nhận diện mã phiên mới: ${sid}`);
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

                    console.log(`[🎲] Kết quả phiên ${currentResult.phien}: ${d1}-${d2}-${d3} = ${total} (${result})`);
                    currentSessionId = null;
                }
            }
        } catch (e) {
            // Bỏ qua lỗi parse nếu dữ liệu luồng không phải định dạng JSON mong muốn
        }
    });

    wsConnection.on('close', (code, reason) => {
        console.log(`[❌] Kết nối bị đóng từ máy chủ (Code: ${code}). Đang thử kết nối lại sau ${RECONNECT_DELAY/1000}s...`);
        setTimeout(connectWebsocket, RECONNECT_DELAY);
    });

    wsConnection.on('error', (error) => {
        console.log(`[❌] Gặp lỗi luồng kết nối WebSocket: ${error.message}`);
    });
}

// --- Thiết lập API routes của Express Backend ---
app.get('/api/tx', (req, res) => {
    res.json(currentResult);
});

app.get('/', (req, res) => {
    res.json({
        "name": "Sun.Win Binary Streamer (Node.js Model)",
        "status": "Active",
        "synchronized_user": ACTIVE_USER,
        "thoi_gian": getVietnamTime()
    });
});

app.use((req, res) => {
    res.status(404).json({ "error": "Endpoint không tồn tại. Dùng cổng /api/tx" });
});

// Chạy khởi động server ứng dụng
app.listen(PORT, '0.0.0.0', () => {
    console.log("\n" + "="*60);
    console.log(`📡 API ENDPOINT TRUY XUẤT: http://localhost:${PORT}/api/tx`);
    console.log(`👤 Tài khoản đồng bộ: ${ACTIVE_USER}`);
    console.log("="*60 + "\n");
    
    // Bắt đầu mở tiến trình lắng nghe socket
    connectWebsocket();
});

// Dọn dẹp tiến trình khi tắt script
process.on('SIGINT', () => { process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });
