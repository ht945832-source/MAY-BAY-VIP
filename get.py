# server.py
import asyncio
import websockets
import json
import threading
import time
from datetime import datetime, timedelta
from flask import Flask, jsonify
from flask_cors import CORS
import os
import signal
import sys
import socket
import requests
import re

app = Flask(__name__)
CORS(app)
PORT = int(os.environ.get('PORT', 1234))

# Global variables
current_result = {
    "phien": None,
    "xuc_xac_1": None,
    "xuc_xac_2": None,
    "xuc_xac_3": None,
    "tong": None,
    "ket_qua": "",
    "thoi_gian": ""
}

current_session_id = None
ws_connection = None
websocket_task = None
reconnect_delay = 2.5  # seconds
start_time = time.time()

# Hàm lấy thời gian Việt Nam (UTC+7)
def get_vietnam_time():
    utc7_time = datetime.utcnow() + timedelta(hours=7)
    return utc7_time.strftime("%d-%m-%Y %H:%M:%S") + " UTC+7"

def parse_token_data(token_text):
    """Parse token data từ file token.txt"""
    try:
        # Tìm và trích xuất info JSON
        info_match = re.search(r'"info"\x07([^"]+?)"?', token_text)
        if info_match:
            info_str = info_match.group(1)
            info_str = info_str.replace('\x04', '').replace('\x07', '').replace('\x05', '').replace('\x06', '')
            info_data = json.loads(info_str)
            return info_data
        
        # Nếu không tìm thấy info, tìm trực tiếp JSON
        json_match = re.search(r'\{[^{}]*"ipAddress"[^{}]*\}', token_text)
        if json_match:
            return json.loads(json_match.group())
        
        return None
    except Exception as e:
        print(f"[❌] Lỗi parse token: {e}")
        return None

def load_token():
    """Load token từ file token.txt"""
    try:
        with open('token.txt', 'r', encoding='utf-8') as f:
            token_data = f.read().strip()
        
        if not token_data:
            print("[❌] File token.txt trống")
            return None
        
        parsed_data = parse_token_data(token_data)
        if parsed_data:
            print("[✅] Đã load token từ token.txt")
            return parsed_data
        else:
            print("[❌] Không thể parse token từ token.txt")
            return None
            
    except FileNotFoundError:
        print("[❌] Không tìm thấy file token.txt")
        return None
    except Exception as e:
        print(f"[❌] Lỗi đọc token.txt: {e}")
        return None

# Load token data
TOKEN_DATA = load_token()

# ĐƯỜNG DẪN ĐÍNH KÈM TOKEN MỚI CỦA NGƯỜI ANH EM
WEBSOCKET_URL = "https://ws-lby.azhkthg1.net/wsbinary?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJ2aXBnYW1lIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzQ4NzIwNTA0LCJhZmZJZCI6IjI3OTc1NmNmMjMwODQ1ODU5ZGJkNzljODZkYzkzNDVlIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJzdW4ud2luIiwiZW1haWwiOiIiLCJ0aW1lc3RhbXAiOjE3ODI2NTY4OTY2MzgsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjQwMjo4MDA6NjFkNzpkNTkyOjc4NzE6MTgyYTpmMGJkOmVmYmEiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzA3LnBuZyIsInBsYXRmb3JtSWQiOjQsInVzZXJJZCI6Ijg5NTMwM2I0LTgwMzMtNDYzNC04OGUwLWU0ZWQyZmM2Yjg2YyIsImVtYWlsVmVyaWZpZWQiOm51bGwsInJlZ1RpbWUiOjE3Nzk3MTcwOTM3NTcsInBob25lIjoiIiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19ob2FuZzIyODAifQ.laROx8f6ZBgvr5xH5HVeG0-paEhzHFRzT0lW-k-XXQI"

# THAY ĐỔI CẤU HÌNH HEADERS THEO ĐÚNG THIẾT BỊ IPHONE (MỤC APP TRÊN ẢNH)
WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_11 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6.1 Mobile/15E148 Safari/604.1",
    "Origin": "https://play.sun.pw"
}

# Cập nhật thông tin gói tin khởi tạo theo User mới: SC_hoangz2280
initial_messages = [
    [
        1,
        "MiniGame",
        "SC_hoangz2280",
        "quapit",
        {
            "signature": "05915B436159B8F4E4DFF537639BD014D54EBEFA18CF62A8EB205B4074010AD72AEA9A780D5A8A4E1BD59BBBAFE03902C594B5DA56FD60D099F1FDDCCD48385FCC2760B5B0B4B8E75D39B8E40DF8CB7C01EA58DBEDA32805927473AB71FA9B798B0C2EDC445C3E36E47EF0AAFAD45601D99AAD1EC642FD2B63573A0401D6EC69",
            "expireIn": 1782656896638,
            "wsToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJ2aXBnYW1lIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzQ4NzIwNTA0LCJhZmZJZCI6IjI7OTc1NmNmMjMwODQ1ODU5ZGJkNzljODZkYzkzNDVlIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJzdW4ud2luIiwiZW1haWwiOiIiLCJ0aW1lc3RhbXAiOjE3ODI2NTY4OTY2MzgsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjQwMjo4MDA6NjFkNzpkNTkyOjc4NzE6MTgyYTpmMGJkOmVmYmEiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzA3LnBuZyIsInBsYXRmb3JtSWQiOjQsInVzZXJJZCI6Ijg5NTMwM2I0LTgwMzMtNDYzNC04OGUwLWU0ZWQyZmM2Yjg2YyIsImVtYWlsVmVyaWZpZWQiOm51bGwsInJlZ1RpbWUiOjE3Nzk3MTcwOTM3NTcsInBob25lIjoiIiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19ob2FuZzIyODAifQ.laROx8f6ZBgvr5xH5HVeG0-paEhzHFRzT0lW-k-XXQI",
            "accessToken": "7e9a9ecbff1b4a6393b48346f6d8b709",
            "message": "Thành công",
            "refreshToken": "",
            "info": {}
        }
    ],
    [6, "MiniGame", "taixiuPlugin", {"cmd": 1005}],
    [6, "MiniGame", "lobbyPlugin", {"cmd": 10001}]
]

def get_network_info():
    try:
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        try:
            response = requests.get('https://api.ipify.org?format=json', timeout=5)
            public_ip = response.json()['ip']
        except:
            public_ip = None
        return {'localIP': local_ip, 'publicIP': public_ip}
    except Exception as e:
        print(f"Lỗi lấy network info: {e}")
        return {'localIP': '127.0.0.1', 'publicIP': None}

def handle_error(context, error):
    error_msg = f"Lỗi - {context}: {str(error)}"
    print(f"[❌] {error_msg}")
    return error_msg

def get_ws_connect_kwargs():
    kwargs = {
        "ping_interval": 15,
        "ping_timeout": 10,
    }
    try:
        ws_version = tuple(int(x) for x in websockets.__version__.split('.')[:2])
        if ws_version >= (11, 0):
            kwargs["additional_headers"] = WS_HEADERS
        else:
            kwargs["extra_headers"] = WS_HEADERS
    except Exception:
        kwargs["additional_headers"] = WS_HEADERS
    return kwargs

async def connect_websocket():
    global ws_connection, current_session_id, current_result
    connect_kwargs = get_ws_connect_kwargs()
    
    while True:
        try:
            print("[🔄] Đang kết nối WebSocket dạng Binary...")
            # Thay đổi giao thức wss nếu link bắt đầu bằng https://
            ws_url = WEBSOCKET_URL.replace("https://", "wss://")
            
            ws_connection = await websockets.connect(
                ws_url,
                **connect_kwargs
            )
            print("[✅] Kết nối thành công đến Sun.Win (iOS Safari Mode)")
            
            # Gửi gói tin bắt tay ban đầu
            for i, msg in enumerate(initial_messages):
                await asyncio.sleep(i * 0.6)
                await ws_connection.send(json.dumps(msg))
            
            # Đọc luồng dữ liệu liên tục từ Server
            async for message in ws_connection:
                try:
                    # NẾU NHẬN BYTES (DỮ LIỆU NHỊ PHÂN), TIẾN HÀNH GIẢI MÃ SANG TEXT
                    if isinstance(message, bytes):
                        message = message.decode('utf-8')
                        
                    data = json.loads(message)
                    
                    if not isinstance(data, list) or len(data) < 2:
                        continue
                    
                    if isinstance(data[1], dict):
                        cmd = data[1].get('cmd')
                        sid = data[1].get('sid')
                        d1 = data[1].get('d1')
                        d2 = data[1].get('d2')
                        d3 = data[1].get('d3')
                        gBB = data[1].get('gBB')
                        
                        if cmd == 1008 and sid:
                            current_session_id = sid
                            print(f"[🎮] Phiên mới: {sid}")
                        
                        if cmd == 1003 and gBB:
                            if d1 is None or d2 is None or d3 is None:
                                continue
                            
                            total = d1 + d2 + d3
                            result = "Tài" if total > 10 else "Xỉu"
                            
                            current_result = {
                                "phien": current_session_id,
                                "xuc_xac_1": d1,
                                "xuc_xac_2": d2,
                                "xuc_xac_3": d3,
                                "tong": total,
                                "ket_qua": result,
                                "thoi_gian": get_vietnam_time()
                            }
                            
                            print(f"[🎲] Phiên {current_result['phien']}: {d1}-{d2}-{d3} = {total} ({result}) - {current_result['thoi_gian']}")
                            current_session_id = None
                            
                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    handle_error("Xử lý message", e)
                    
        except websockets.exceptions.ConnectionClosed as e:
            handle_error("WebSocket đóng đột ngột", e)
            await asyncio.sleep(reconnect_delay)
        except Exception as e:
            handle_error("Lỗi kết nối", e)
            await asyncio.sleep(reconnect_delay)

@app.route('/api/tx', methods=['GET'])
def get_tx_result():
    return jsonify(current_result)

@app.route('/', methods=['GET'])
def index():
    return jsonify({
        "name": "Sun.Win Tài Xỉu Data Stream (Binary Model)",
        "version": "1.2",
        "endpoints": {
            "/api/tx": "Lấy kết quả tài xỉu mới nhất"
        },
        "thoi_gian": get_vietnam_time(),
        "status": "Running (iOS Emulation)"
    })

def run_flask():
    try:
        app.run(host='0.0.0.0', port=PORT, debug=False, use_reloader=False)
    except Exception as e:
        handle_error("Flask server", e)

async def main():
    global start_time
    start_time = time.time()
    network_info = get_network_info()
    
    print("\n" + "="*60)
    print("🎲 Sun.Win Tài Xỉu Data Stream - SAFARI BINARY PORT")
    print("="*60)
    print(f"📡 API Live tại: http://localhost:{PORT}/api/tx")
    print("="*60 + "\n")
    
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    
    await connect_websocket()

def signal_handler(sig, frame):
    sys.exit(0)

if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
