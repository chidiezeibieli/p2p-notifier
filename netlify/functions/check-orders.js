const crypto = require("crypto");

const API_KEY = process.env.BITGET_API_KEY;
const SECRET_KEY = process.env.BITGET_SECRET_KEY;
const PASSPHRASE = process.env.BITGET_PASSPHRASE;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sign(timestamp, method, requestPath, body = "") {
  const message = timestamp + method.toUpperCase() + requestPath + body;
  return crypto.createHmac("sha256", SECRET_KEY).update(message).digest("base64");
}

async function bitgetRequest(method, path, params = {}) {
  const timestamp = Date.now().toString();
  
  let requestPath = path;
  const queryString = new URLSearchParams(params).toString();
  if (queryString) {
    requestPath = path + "?" + queryString;
  }

  const signature = sign(timestamp, method, requestPath);

  const url = "https://api.bitget.com" + requestPath;

  const res = await fetch(url, {
    method: method,
    headers: {
      "ACCESS-KEY": API_KEY,
      "ACCESS-SIGN": signature,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": PASSPHRASE,
      "Content-Type": "application/json",
      "locale": "en-US"
    }
  });

  return res.json();
}

async function sendTelegram(text) {
  await fetch("https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text: text,
      parse_mode: "HTML"
    })
  });
}

exports.handler = async function () {
  try {
    await sendTelegram("🔄 Function is running...");

    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;

    const data = await bitgetRequest("GET", "/api/v2/p2p/orderList", {
      startTime: start.toString(),
      endTime: end.toString(),
      limit: "20",
      status: "pending_pay"
    });

    if (data.code !== "00000") {
      await sendTelegram("⚠️ Bitget Error: " + (data.msg || JSON.stringify(data)));
      return { statusCode: 200, body: "Bitget error" };
    }

    const orders = data.data && data.data.orderList ? data.data.orderList : [];

    if (orders.length === 0) {
      await sendTelegram("✅ No new pending orders right now.");
      return { statusCode: 200, body: "No orders" };
    }

    for (const order of orders) {
      const message = "🔔 New P2P Order\n\n" +
        "Order: " + (order.orderNo || order.orderId) + "\n" +
        "Side: " + (order.side || "").toUpperCase() + "\n" +
        "Amount: " + order.count + " " + order.coin + "\n" +
        "Fiat: " + order.amount + " " + order.fiat + "\n" +
        "Price: " + order.price + "\n" +
        "Status: " + order.status;

      await sendTelegram(message);
    }

    return { statusCode: 200, body: "Done" };
  } catch (err) {
    await sendTelegram("❌ Function crashed: " + err.message);
    return { statusCode: 500, body: err.message };
  }
};
