#!/usr/bin/env python3
"""
whatsapp_api.py — PropEdge WhatsApp Python Service
──────────────────────────────────────────────────────────────────────────────
Python interface to the WhatsApp bridge (server.js).
Run this in Termux alongside server.js.

Usage:
  python3 whatsapp_api.py                     # Run as standalone API
  from whatsapp_api import send_whatsapp      # Import in other scripts

Setup in Termux:
  pkg install python nodejs
  pip install flask requests
  cd whatsapp-bridge && npm install
  node server.js &           # Start WA bridge in background
  python3 whatsapp_api.py    # Start Python API
──────────────────────────────────────────────────────────────────────────────
"""

import requests
import json
import os
from flask import Flask, request, jsonify
from datetime import datetime

# ── CONFIG ────────────────────────────────────────────────────────────────────
WA_BRIDGE_URL = os.environ.get('WA_BRIDGE_URL', 'http://localhost:3001')
PYTHON_API_PORT = int(os.environ.get('WA_PYTHON_PORT', 3002))
AGENT_NAME = os.environ.get('AGENT_NAME', 'PropEdge Team')
VERCEL_URL = os.environ.get('PROPEDGE_BACKEND_URL', 'https://scaleover-lemon.vercel.app')

app = Flask(__name__)

# ── CORE SEND FUNCTION ────────────────────────────────────────────────────────

def send_whatsapp(phone: str, message: str) -> dict:
    """
    Send a WhatsApp message via the bridge.
    Falls back to logging if bridge not reachable.
    """
    try:
        r = requests.post(
            f'{WA_BRIDGE_URL}/send',
            json={'to': phone, 'message': message},
            timeout=10
        )
        result = r.json()
        if result.get('success'):
            print(f'✅ WhatsApp sent to {phone}')
        else:
            print(f'⚠️  WhatsApp fallback for {phone}: {result.get("error")}')
        return result
    except Exception as e:
        print(f'❌ WhatsApp bridge not reachable: {e}')
        print(f'[SIMULATED] To: {phone}\n{message}\n')
        return {'success': False, 'simulated': True, 'error': str(e)}


def send_bulk(recipients: list, message: str) -> dict:
    """Send same message to multiple numbers."""
    try:
        r = requests.post(
            f'{WA_BRIDGE_URL}/send-bulk',
            json={'recipients': recipients, 'message': message},
            timeout=60
        )
        return r.json()
    except Exception as e:
        return {'success': False, 'error': str(e)}


def get_status() -> dict:
    """Check if WhatsApp bridge is connected."""
    try:
        r = requests.get(f'{WA_BRIDGE_URL}/status', timeout=5)
        return r.json()
    except:
        return {'ready': False, 'message': 'Bridge not reachable'}


# ── MESSAGE TEMPLATES ─────────────────────────────────────────────────────────

def send_booking_confirmation(client_phone: str, visit: dict) -> dict:
    maps = f"https://www.google.com/maps/search/?api=1&query={requests.utils.quote(visit.get('property_name','') + ' India')}"
    msg = f"""🏠 *{AGENT_NAME}*

Hi {visit.get('client_name', 'there')},

✅ Your property visit is *CONFIRMED!*

📌 *Property:* {visit.get('property_name', 'N/A')}
📅 *Date:* {visit.get('visit_date', 'N/A')}
🕒 *Time:* {visit.get('visit_time', 'N/A')}
✅ *Status:* Confirmed

📍 *Location:* {maps}

We look forward to seeing you! If you need to reschedule, reply to this message.

_PropEdge Real Estate_"""
    return send_whatsapp(client_phone, msg)


def send_new_lead_alert(agent_phone: str, lead: dict) -> dict:
    msg = f"""⚡ *New Lead Alert*

A new buyer just submitted a query!

👤 *Name:* {lead.get('name', 'N/A')}
📞 *Phone:* {lead.get('phone', 'N/A')}
🏠 *Interest:* {lead.get('property_interest', 'N/A')}
💰 *Budget:* {lead.get('budget', 'Not specified')}

🤖 AI is calling them now...

🔗 Dashboard: {VERCEL_URL}/propedge_dashboard.html

_PropEdge CRM_"""
    return send_whatsapp(agent_phone, msg)


def send_visit_reminder(client_phone: str, visit: dict) -> dict:
    maps = f"https://www.google.com/maps/search/?api=1&query={requests.utils.quote(visit.get('property_name','') + ' India')}"
    msg = f"""🏠 *{AGENT_NAME} — Reminder*

Hi {visit.get('client_name', 'there')},

⏰ Your property visit is *tomorrow!*

📌 *Property:* {visit.get('property_name', 'N/A')}
📅 *Date:* {visit.get('visit_date', 'N/A')}
🕒 *Time:* {visit.get('visit_time', 'N/A')}

📍 *Google Maps:* {maps}

Please arrive 5 minutes early. See you soon! 🙌

_PropEdge Real Estate_"""
    return send_whatsapp(client_phone, msg)


def send_transfer_alert(agent_phone: str, lead_name: str, lead_phone: str) -> dict:
    msg = f"""🔥 *URGENT — Call Back Needed*

AI transferred a high-intent lead to you!

👤 *Lead:* {lead_name}
📞 *Phone:* {lead_phone}

They asked to speak with a human agent.
*Call them back immediately!*

_PropEdge AI Agent_"""
    return send_whatsapp(agent_phone, msg)


def send_ai_intro(client_phone: str, lead: dict) -> dict:
    msg = f"""🏠 *{AGENT_NAME}*

Hi {lead.get('name', 'there')}!

I'm Aria, your AI property specialist. I noticed you're interested in {lead.get('property_interest', 'our properties')}.

I'm calling you right now to help you find the perfect property! 📞

If I miss you, feel free to reply here and I'll be happy to help.

_Aria @ PropEdge Real Estate_"""
    return send_whatsapp(client_phone, msg)


# ── PYTHON API ROUTES (called by Vercel backend) ──────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    status = get_status()
    return jsonify({
        'python_api': 'online',
        'whatsapp_bridge': status,
        'time': datetime.now().isoformat()
    })

@app.route('/send', methods=['POST'])
def api_send():
    data = request.json or {}
    phone = data.get('phone') or data.get('to')
    message = data.get('message')
    if not phone or not message:
        return jsonify({'success': False, 'error': 'phone and message required'}), 400
    result = send_whatsapp(phone, message)
    return jsonify(result)

@app.route('/send-bulk', methods=['POST'])
def api_send_bulk():
    data = request.json or {}
    recipients = data.get('recipients', [])
    message = data.get('message', '')
    if not recipients or not message:
        return jsonify({'success': False, 'error': 'recipients and message required'}), 400
    result = send_bulk(recipients, message)
    return jsonify(result)

@app.route('/booking-confirmation', methods=['POST'])
def api_booking():
    data = request.json or {}
    phone = data.get('client_phone')
    visit = data.get('visit', {})
    if not phone:
        return jsonify({'success': False, 'error': 'client_phone required'}), 400
    result = send_booking_confirmation(phone, visit)
    return jsonify(result)

@app.route('/new-lead-alert', methods=['POST'])
def api_lead_alert():
    data = request.json or {}
    agent_phone = data.get('agent_phone')
    lead = data.get('lead', {})
    if not agent_phone:
        return jsonify({'success': False, 'error': 'agent_phone required'}), 400
    result = send_new_lead_alert(agent_phone, lead)
    return jsonify(result)

@app.route('/reminder', methods=['POST'])
def api_reminder():
    data = request.json or {}
    phone = data.get('client_phone')
    visit = data.get('visit', {})
    result = send_visit_reminder(phone, visit)
    return jsonify(result)

@app.route('/transfer-alert', methods=['POST'])
def api_transfer():
    data = request.json or {}
    result = send_transfer_alert(
        data.get('agent_phone', ''),
        data.get('lead_name', 'Unknown'),
        data.get('lead_phone', 'Unknown')
    )
    return jsonify(result)

# ── START ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print('\n🐍 PropEdge WhatsApp Python API')
    print(f'   Bridge: {WA_BRIDGE_URL}')
    print(f'   API:    http://localhost:{PYTHON_API_PORT}')

    # Check bridge on startup
    status = get_status()
    if status.get('ready'):
        print('   ✅ WhatsApp bridge connected!')
    else:
        print(f'   ⚠️  Bridge status: {status.get("message")}')
        print(f'   → Open http://localhost:3001/qr to scan QR code')

    print()
    app.run(host='0.0.0.0', port=PYTHON_API_PORT, debug=False)
