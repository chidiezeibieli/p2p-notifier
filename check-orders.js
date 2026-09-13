const crypto = require("crypto");

const API_KEY = process.env.BITGET_API_KEY;
const SECRET_KEY = process.env.BITGET_SECRET_KEY;
const PASSPHRASE = process.env.BITGET_PASSPHRASE;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sign(timestamp, method, requestPath, body = "") {
  const message = `\( {timestamp} \){method.toUpperCase()}\( {requestPath} \){body}`;
  return crypto
    .createHmac("sha256", SECRET_KEY)
    .update(message)
    .digest("base64");
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
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text,
      parse_mode: "HTML",
    }),
  });
}

exports.handler = async function () {
  try {
    // Get recent pending orders (last 24 hours)
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;

    const data = await bitgetRequest("GET", "/api/v2/p2p/orderList", {
      startTime: start.toString(),
      endTime: end.toString(),
      limit: "20",
      status: "pending_pay",
    });

    if (data.code !== "00000") {
      await sendTelegram(`⚠️ Bitget error: ${data.msg || JSON.stringify(data)}`);
      return { statusCode: 200, body: "Error checked" };
    }

    const orders = data.data?.orderList || [];

    if (orders.length === 0) {
      return { statusCode: 200, body: "No new orders" };
    }

    // For now we just notify about all pending orders found
    // (Later we can add memory so it only notifies new ones)
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

    return {
      statusCode: 200,
      body: `Notified ${orders.length} order(s)`,
    };
  } catch (err) {
    await sendTelegram(`❌ Function error: ${err.message}`);
    return { statusCode: 500, body: err.message };
  }
};