const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

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
  if (queryString) requestPath = path + "?" + queryString;

  const signature = sign(timestamp, method, requestPath);
  const url = "https://api.bitget.com" + requestPath;

  const res = await fetch(url, {
    method,
    headers: {
      "ACCESS-KEY": API_KEY,
      "ACCESS-SIGN": signature,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": PASSPHRASE,
      "Content-Type": "application/json",
      locale: "en-US"
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

async function getSetting(key, defaultValue = null) {
  try {
    const store = getStore("p2p-settings");
    const value = await store.get(key);
    return value !== null ? value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

async function setSetting(key, value) {
  const store = getStore("p2p-settings");
  await store.set(key, String(value));
}

async function getMarketPrices() {
  // Get top buy ads (people selling USDT - highest prices first usually)
  const buyData = await bitgetRequest("GET", "/api/v3/p2p/ad-list", {
    token: "USDT",
    fiat: "NGN",
    side: "buy",
    pageNum: "1",
    limit: "10"
  });

  // Get top sell ads (people buying USDT - lowest prices)
  const sellData = await bitgetRequest("GET", "/api/v3/p2p/ad-list", {
    token: "USDT",
    fiat: "NGN",
    side: "sell",
    pageNum: "1",
    limit: "10"
  });

  const buyAds = buyData.code === "00000" ? (buyData.data || []) : [];
  const sellAds = sellData.code === "00000" ? (sellData.data || []) : [];

  const buyPrices = buyAds.map(a => parseFloat(a.price)).filter(p => !isNaN(p));
  const sellPrices = sellAds.map(a => parseFloat(a.price)).filter(p => !isNaN(p));

  return {
    buy: {
      highest: buyPrices.length ? Math.max(...buyPrices) : null,
      lowest: buyPrices.length ? Math.min(...buyPrices) : null,
      average: buyPrices.length ? (buyPrices.reduce((a, b) => a + b, 0) / buyPrices.length).toFixed(2) : null
    },
    sell: {
      highest: sellPrices.length ? Math.max(...sellPrices) : null,
      lowest: sellPrices.length ? Math.min(...sellPrices) : null,
      average: sellPrices.length ? (sellPrices.reduce((a, b) => a + b, 0) / sellPrices.length).toFixed(2) : null
    }
  };
}

async function checkCommands() {
  try {
    const res = await fetch("https://api.telegram.org/bot" + TG_TOKEN + "/getUpdates?offset=-10");
    const data = await res.json();
    if (!data.ok || !data.result) return;

    for (const update of data.result) {
      const msg = update.message;
      if (!msg || !msg.text) continue;
      if (String(msg.chat.id) !== String(TG_CHAT_ID)) continue;

      const text = msg.text.trim();
      const lower = text.toLowerCase();

      if (lower === "/on") {
        await setSetting("enabled", "true");
        await sendTelegram("✅ Notifications turned <b>ON</b>");
      } 
      else if (lower === "/off") {
        await setSetting("enabled", "false");
        await sendTelegram("⏸ Notifications turned <b>OFF</b>");
      } 
      else if (lower === "/status") {
        const enabled = await getSetting("enabled", "true");
        const buyTarget = await getSetting("buyTarget");
        const sellTarget = await getSetting("sellTarget");
        let msg = enabled === "true" ? "✅ Status: <b>ON</b>" : "⏸ Status: <b>OFF</b>";
        if (buyTarget) msg += "\nBuy alert below: ₦" + buyTarget;
        if (sellTarget) msg += "\nSell alert above: ₦" + sellTarget;
        await sendTelegram(msg);
      }
      else if (lower === "/price") {
        const prices = await getMarketPrices();
        const msg = `📊 <b>USDT/NGN Market</b>

<b>Buy side</b> (you sell USDT):
Highest: ₦${prices.buy.highest || "N/A"}
Lowest: ₦${prices.buy.lowest || "N/A"}
Average: ₦${prices.buy.average || "N/A"}

<b>Sell side</b> (you buy USDT):
Highest: ₦${prices.sell.highest || "N/A"}
Lowest: ₦${prices.sell.lowest || "N/A"}
Average: ₦${prices.sell.average || "N/A"}`;
        await sendTelegram(msg);
      }
      else if (lower.startsWith("/setbuy ")) {
        const price = text.split(" ")[1];
        await setSetting("buyTarget", price);
        await sendTelegram("✅ Buy alert set: notify when price drops below ₦" + price);
      }
      else if (lower.startsWith("/setsell ")) {
        const price = text.split(" ")[1];
        await setSetting("sellTarget", price);
        await sendTelegram("✅ Sell alert set: notify when price rises above ₦" + price);
      }
      else if (lower === "/help") {
        await sendTelegram(`📖 <b>Commands</b>

/on - Turn notifications on
/off - Turn notifications off
/status - Check current status
/price - Show current USDT/NGN prices
/setbuy 1600 - Alert when buy price drops below 1600
/setsell 1700 - Alert when sell price rises above 1700
/help - Show this message`);
      }
    }
  } catch (err) {
    console.log("Command error:", err.message);
  }
}

exports.handler = async function () {
  try {
    // Handle commands first
    await checkCommands();

    const enabled = await getSetting("enabled", "true");
    if (enabled === "false") {
      return { statusCode: 200, body: "Notifier is OFF" };
    }

    // === Check new pending orders ===
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;

    const orderData = await bitgetRequest("GET", "/api/v2/p2p/orderList", {
      startTime: start.toString(),
      endTime: end.toString(),
      limit: "20",
      status: "pending_pay"
    });

    if (orderData.code === "00000") {
      const orders = orderData.data && orderData.data.orderList ? orderData.data.orderList : [];
      for (const order of orders) {
        const message = "🔔 <b>New P2P Order</b>\n\n" +
          "Order: <code>" + (order.orderNo || order.orderId) + "</code>\n" +
          "Side: " + (order.side || "").toUpperCase() + "\n" +
          "Amount: " + order.count + " " + order.coin + "\n" +
          "Fiat: " + order.amount + " " + order.fiat + "\n" +
          "Price: " + order.price + "\n" +
          "Status: " + order.status;
        await sendTelegram(message);
      }
    }

    // === Check price alerts ===
    const prices = await getMarketPrices();
    const buyTarget = await getSetting("buyTarget");
    const sellTarget = await getSetting("sellTarget");

    if (buyTarget && prices.buy.lowest && prices.buy.lowest <= parseFloat(buyTarget)) {
      await sendTelegram("📉 <b>Buy Price Alert!</b>\n\nLowest buy price is now ₦" + prices.buy.lowest + "\n(Your target was ₦" + buyTarget + ")");
    }

    if (sellTarget && prices.sell.highest && prices.sell.highest >= parseFloat(sellTarget)) {
      await sendTelegram("📈 <b>Sell Price Alert!</b>\n\nHighest sell price is now ₦" + prices.sell.highest + "\n(Your target was ₦" + sellTarget + ")");
    }

    return { statusCode: 200, body: "Done" };
  } catch (err) {
    await sendTelegram("❌ Function crashed: " + err.message);
    return { statusCode: 500, body: err.message };
  }
};
