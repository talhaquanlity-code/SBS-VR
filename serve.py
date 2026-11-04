"""
VR Passthrough SBS - Local Development & Mobile Streaming Server
Run this script to test on your phone over local Wi-Fi:
    python serve.py
"""

import http.server
import socket
import socketserver
import sys
import webbrowser

PORT = 8080

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable caching-free dev and proper MIME types
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, format, *args):
        # Clean terminal output
        if "404" in format % args:
            sys.stderr.write(f"[-] {format % args}\n")

def get_local_ips():
    ips = []
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    return ips

def main():
    ips = get_local_ips()
    local_ip = ips[0] if ips else "localhost"

    print("=" * 64)
    print("  🥽 VR PASSTHROUGH SBS - MOBILE HEADSET SERVER")
    print("=" * 64)
    print(f"\n  [✔] Local PC URL:      http://localhost:{PORT}")
    print(f"  [✔] Mobile Phone URL:  http://{local_ip}:{PORT}\n")
    print("-" * 64)
    print("  📱 HOW TO OPEN ON YOUR MOBILE PHONE:")
    print(f"  1. Connect your phone to the same Wi-Fi network as this PC.")
    print(f"  2. Open Chrome or Safari on your phone and navigate to:")
    print(f"         http://{local_ip}:{PORT}")
    print(f"  3. Tap 'Enter VR' to go fullscreen, put phone in headset!")
    print("-" * 64)
    print("  💡 MOBILE CAMERA OVER WI-FI TIP (If camera is blocked):")
    print("  If Chrome on Android blocks camera on http://, open:")
    print("      chrome://flags/#unsafely-treat-insecure-origin-as-secure")
    print(f"  Add 'http://{local_ip}:{PORT}' and enable it, then relaunch Chrome.")
    print("  (Or test immediately with the built-in 3D Virtual Test Scene!)")
    print("=" * 64)
    print("  Press Ctrl+C to stop the server.\n")

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), QuietHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main()

