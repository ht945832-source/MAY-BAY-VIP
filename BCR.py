import requests
from bs4 import BeautifulSoup
from urllib.parse import unquote
import time
import threading
import os
from flask import Flask, jsonify

# ======================
# Cấu hình tài khoản game
# ======================
BASE = "https://aibcr.me"
LOGIN_URL = f"{BASE}/login"
LOBBY_URL = f"{BASE}/ae/lobby"
GETNEWRESULT_URL = f"{BASE}/baccarat/getnewresult"

USERNAME = "Hoang2285"
PASSWORD = "hoang2010"

# ======================
# Biến khởi tạo toàn cục
# ======================
session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
})

last_results = {}      # Lưu lịch sử để phát hiện phiên mới
filtered_data = []     # Danh sách chứa kết quả các bàn dữ liệu
auto_running = True

# ======================
# Các hàm chức năng hệ thống
# ======================
def get_csrf_token(html):
    soup = BeautifulSoup(html, "html.parser")
    t = soup.find("input", {"name": "_token"})
    if t and t.get("value"):
        return t["value"]
    meta = soup.find("meta", {"name": "csrf-token"})
    if meta and meta.get("content"):
        return meta["content"]
    return None

def login():
    try:
        r = session.get(LOGIN_URL, timeout=15)
        token = get_csrf_token(r.text)
        payload = {"username": USERNAME, "password": PASSWORD, "action": "Login"}
        if token:
            payload["_token"] = token
        headers = {"Referer": LOGIN_URL, "Origin": BASE, "Content-Type": "application/x-www-form-urlencoded"}
        resp = session.post(LOGIN_URL, data=payload, headers=headers, timeout=15)
        print("✅ Đăng nhập hệ thống gốc:", resp.status_code)
    except Exception as e:
        print("❌ Lỗi trong quá trình Đăng nhập:", e)

def go_to_lobby():
    try:
        session.get(LOBBY_URL, timeout=15)
    except Exception as e:
        print("❌ Lỗi khi thiết lập vào sảnh Lobby:", e)

def call_getnewresult():
    global filtered_data
    xsrf_token = unquote(session.cookies.get("XSRF-TOKEN", ""))
    headers = {
        "Referer": LOBBY_URL,
        "Origin": BASE,
        "X-Requested-With": "XMLHttpRequest",
        "X-XSRF-TOKEN": xsrf_token,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    }

    try:
        resp = session.post(GETNEWRESULT_URL, headers=headers, data={"gameCode": "ae"}, timeout=15)
        if not resp.ok:
            print(f"⚠️ API sảnh lỗi phản hồi: {resp.status_code}")
            return

        data = resp.json().get("data", [])
        new_filtered = []

        for t in data:
            tb_name = t.get("table_name", "")
            curr = t.get("result", "")
            prev = last_results.get(tb_name, "")

            # Kiểm tra phát hiện sự thay đổi kết quả (Có phiên mới xuất hiện)
            if curr and curr != prev:
                last_results[tb_name] = curr
                new_filtered.append({
                    "table_name": tb_name,
                    "result": curr,
                    "goodRoad": t.get("goodRoad", ""),
                    "shoeId": t.get("shoeId", ""),
                    "round": t.get("round", ""),
                    "time": time.strftime("%H:%M:%S")
                })

        if new_filtered:
            fd_dict = {item["table_name"]: item for item in filtered_data}
            for f in new_filtered:
                fd_dict[f["table_name"]] = f
                print(f"✅ Bàn [{f['table_name']}] cập nhật kết quả mới: {f['result']}")
            filtered_data = list(fd_dict.values())

    except Exception as e:
        print("❌ Lỗi đồng bộ dữ liệu call_getnewresult:", e)

# Vòng lặp lấy dữ liệu ngầm tự động
def auto_loop():
    while auto_running:
        call_getnewresult()
        time.sleep(3) # Cài đặt 3 giây quét 1 lần để tránh bị chặn IP (Rate limit)

# ======================
# CẤU HÌNH ROUTE API FLASK
# ======================
app = Flask(__name__)

# Route trang chủ: Khắc phục triệt để lỗi "Not Found" (404) khi vào link Render chính
@app.route("/")
def home():
    return jsonify({
        "status": "Hệ thống API đang chạy ngầm ổn định",
        "total_active_tables": len(filtered_data),
        "endpoint_lay_data": "/data",
        "author": "@tranhoang2286"
    })

# Route trả về dữ liệu JSON dạng danh sách cho Tool đọc
@app.route("/data")
def get_data():
    sorted_data = sorted(filtered_data, key=lambda x: x["table_name"])
    return jsonify(sorted_data)

# ======================
# Khởi chạy ứng dụng
# ======================
if __name__ == "__main__":
    login()
    go_to_lobby()
    
    # Kích hoạt luồng chạy ngầm cào dữ liệu liên tục
    threading.Thread(target=auto_loop, daemon=True).start()
    
    # Cấu hình lấy PORT tự động từ máy chủ Render để không bị lỗi treo sập Deploy
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
