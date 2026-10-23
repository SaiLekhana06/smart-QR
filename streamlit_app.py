"""
Streamlit Wrapper for SmartQR React/Vite Application
Enables 1-click deployment on Streamlit Community Cloud (share.streamlit.io)
"""
import os
import sys
import subprocess
import threading
import http.server
import socketserver
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="SmartQR - Product Authentication System",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Custom styling to remove Streamlit container padding for a native app feel
st.markdown("""
<style>
    .block-container {
        padding-top: 0.5rem !important;
        padding-bottom: 0rem !important;
        padding-left: 0.5rem !important;
        padding-right: 0.5rem !important;
        max-width: 100% !important;
    }
    header[data-testid="stHeader"] {
        background-color: transparent !important;
    }
    footer {
        display: none !important;
    }
</style>
""", unsafe_allow_html=True)

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(APP_DIR, "dist")
PORT = 8055

# Ensure dist folder is built
def ensure_build():
    if not os.path.exists(os.path.join(DIST_DIR, "index.html")):
        with st.spinner("Building SmartQR web application (npm run build)..."):
            subprocess.run(["npm", "run", "build"], cwd=APP_DIR, check=True)

# Run background HTTP static server for dist/
class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def do_GET(self):
        # Serve index.html for client-side routing if file not found
        path = self.translate_path(self.path)
        if not os.path.exists(path) and not path.endswith('/'):
            self.path = '/index.html'
        return super().do_GET()

def start_server():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), SPAHandler) as httpd:
        httpd.serve_forever()

if "server_started" not in st.session_state:
    try:
        ensure_build()
        server_thread = threading.Thread(target=start_server, daemon=True)
        server_thread.start()
        st.session_state["server_started"] = True
    except Exception as e:
        st.error(f"Failed to start local static service: {e}")

# Render full-bleed iframe with camera permissions enabled
iframe_html = f"""
<iframe 
    src="http://localhost:{PORT}" 
    width="100%" 
    height="920px" 
    frameborder="0" 
    allow="camera; microphone; clipboard-write; clipboard-read"
    style="border: none; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);"
></iframe>
"""

components.html(iframe_html, height=930, scrolling=True)
