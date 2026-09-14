const crypto = require("crypto");

const API_KEY = process.env.BITGET_API_KEY;
const SECRET_KEY = process.env.BITGET_SECRET_KEY;
const PASSPHRASE = process.env.BITGET_PASSPHRASE;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sign(timestamp, method, requestPath, body = "") {
  const message = `\( {timestamp} \){method.toUpperCase()}\( {requestPath} \){body}`;
  return crypto.createHmac("sha256", SECRET_KEY).update(message).digest("base64");
}

async function bitgetRequest(method, path, params = {}) {
  const timestamp = Date.now().toString();
  const query = new URLSearchParams(params).toString();
  const requestPath = query ? `\( {path}? \){query}` : path;
  const signature = sign(timestamp, method, requestPath);

  const res = await fetch(`https://api.bitget.com${requestPath}`, {
    method,
    headers: {
      "ACCESS-KEY": API_KEY,
      "ACCESS-SIGN": signature,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": PASSPHRASE,
      "Content-Type": "application/json",
      locale: "en-US",
    },
  });

  return res.json();
}

async function sendTelegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: text,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.log("Telegram error:", err.message);
  }
}

exports.handler = async function () {
  try {
    // Always send a heartbeat so we know the function is running
    await sendTelegram("🔄 Function is running...");

    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;

    const data = await bitgetRequest("GET", "/api/v2/p2p/orderList", {
      startTime: start.toString(),
      endTime: end.toString(),
      limit: "20",
      status: "pending_pay",
    });

    if (data.code !== "00000") {
      await sendTelegram(`⚠️ Bitget Error:\n${data.msg || JSON.stringify(data)}`);
      return { statusCode: 200, body: "Bitget error" };
    }

    const orders = data.data?.orderList || [];

    if (orders.length === 0) {
      await sendTelegram("✅ No new pending orders right now.");
      return { statusCode: 200, body: "No orders" };
    }

    for (const order of orders) {
      const message = `
🔔 <b>New P2P Order</b>

Order: <code>${order.orderNo || order.orderId}</code>
Side: ${order.side?.toUpperCase()}
Amount: ${order.count} ${order.coin}
Fiat: ${order.amount} ${order.fiat}
Price: ${order.price}
Status: ${order.status}
      `.trim();

      await sendTelegram(message);
    }

    return { statusCode: 200, body: `Notified ${orders.length} orders` };
  } catch (err) {
    await sendTelegram(`❌ Function crashed:\n${err.message}`);
    return { statusCode: 500, body: err.message };
  }
};
