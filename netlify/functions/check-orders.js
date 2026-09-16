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
  const buyData = await bitgetRequest("GET", "/api/v2/p2p/advList", {
    coin: "USDT",
    fiat: "NGN",
    side: "buy",
    status: "online",
    sourceType: "competitior",
    limit: "20",
    language: "en-US"
  });

  const sellData = await bitgetRequest("GET", "/api/v2/p2p/advList", {
    coin: "USDT",
    fiat: "NGN",
    side: "sell",
    status: "online",
    sourceType: "competitior",
    limit: "20",
    language: "en-US"
  });

  const buyAds = (buyData.code === "00000" && buyData.data && buyData.data.advList) ? buyData.data.advList : [];
  const sellAds = (sellData.code === "00000" && sellData.data && sellData.data.advList) ? sellData.data.advList : [];

  const sortedBuy = buyAds
    .map(a => ({ price: parseFloat(a.price), name: a.nickName || a.merchantName || "Merchant" }))
    .filter(a => !isNaN(a.price))
    .sort((a, b) => b.price - a.price)
    .slice(0, 10);

  const sortedSell = sellAds
    .map(a => ({ price: parseFloat(a.price), name: a.nickName || a.merchantName || "Merchant" }))
    .filter(a => !isNaN(a.price))
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);

  return { buy: sortedBuy, sell: sortedSell };
}

async function checkCommands() {
  try {
    const res = await fetch("https://api.telegram.org/bot" + TG_TOKEN + "/getUpdates?offset=-20");
    const data = await res.json();
    if (!data.ok || !data.result) return;

    for (const update of data.result) {
      const msg = update.message;
      if (!msg || !msg.text) continue;
      if (String(msg.chat.id) !== String(TG_CHAT_ID)) continue;

      const text = msg.text.trim();
      const lower = text.toLowerCase();

      const waiting = await getSetting("waitingFor");

      if (waiting === "buy" || waiting === "sell") {
        const price = parseFloat(text);
        if (!isNaN(price) && price > 0) {
          if (waiting === "buy") {
            await setSetting("buyTarget", price);
            await sendTelegram("✅ Buy alert set: notify when price drops below ₦" + price);
          } else {
            await setSetting("sellTarget", price);
            await sendTelegram("✅ Sell alert set: notify when price rises above ₦" + price);
          }
          await setSetting("waitingFor", "none");
        } else {
          await sendTelegram("Please send a valid number (example: 1650)");
        }
        continue;
      }

      if (lower === "/on") {
        await setSetting("enabled", "true");
        await sendTelegram("✅ Notifications turned <b>ON</b>");
      } else if (lower === "/off") {
        await setSetting("enabled", "false");
        await sendTelegram("⏸ Notifications turned <b>OFF</b>");
      } else if (lower === "/status") {
        const enabled = await getSetting("enabled", "true");
        const buyTarget = await getSetting("buyTarget");
        const sellTarget = await getSetting("sellTarget");
        let reply = enabled === "true" ? "✅ Status: <b>ON</b>" : "⏸ Status: <b>OFF</b>";
        if (buyTarget) reply += "\nBuy alert below: ₦" + buyTarget;
        if (sellTarget) reply += "\nSell alert above: ₦" + sellTarget;
        await sendTelegram(reply);
      } else if (lower === "/price") {
        const prices = await getMarketPrices();
        let reply = "📊 <b>USDT/NGN Top 10</b>\n\n";

        reply += "<b>Best places to SELL USDT</b> (Highest prices):\n";
        if (prices.buy.length === 0) reply += "No data\n";
        else prices.buy.forEach((ad, i) => reply += (i + 1) + ". ₦" + ad.price + " — " + ad.name + "\n");

        reply += "\n<b>Best places to BUY USDT</b> (Lowest prices):\n";
        if (prices.sell.length === 0) reply += "No data\n";
        else prices.sell.forEach((ad, i) => reply += (i + 1) + ". ₦" + ad.price + " — " + ad.name + "\n");

        await sendTelegram(reply);
      } else if (lower === "/setbuy") {
        await setSetting("waitingFor", "buy");
        await sendTelegram("Please send the buy price you want (example: 1600)");
      } else if (lower === "/setsell") {
        await setSetting("waitingFor", "sell");
        await sendTelegram("Please send the sell price you want (example: 1700)");
      } else if (lower === "/help") {
        await sendTelegram(`📖 <b>Commands</b>

/on - Turn notifications on
/off - Turn notifications off
/status - Check current status
/price - Show Top 10 buy & sell prices
/setbuy - Set buy price alert
/setsell - Set sell price alert
/help - Show this message`);
      }
    }
  } catch (err) {
    console.log("Command error:", err.message);
  }
}

exports.handler = async function () {
  try {
    await checkCommands();

    const enabled = await getSetting("enabled", "true");
    if (enabled === "false") {
      return { statusCode: 200, body: "Notifier is OFF" };
    }

    // ===== Check pending orders (more reliable) =====
    const end = Date.now();
    const start = end - 48 * 60 * 60 * 1000; // last 48 hours

    const orderData = await bitgetRequest("GET", "/api/v2/p2p/orderList", {
      startTime: start.toString(),
      endTime: end.toString(),
      limit: "50"
    });

    if (orderData.code === "00000") {
      const allOrders = orderData.data && orderData.data.orderList ? orderData.data.orderList : [];

      // Filter for pending statuses
      const pendingOrders = allOrders.filter(o => {
        const status = (o.status || "").toLowerCase();
        return status.includes("pending") || status === "pending_pay" || status === "paid" || status === "unpaid";
      });

      for (const order of pendingOrders) {
        const message = "🔔 <b>Pending P2P Order</b>\n\n" +
          "Order: <code>" + (order.orderNo || order.orderId) + "</code>\n" +
          "Side: " + (order.side || "").toUpperCase() + "\n" +
          "Amount: " + order.count + " " + order.coin + "\n" +
          "Fiat: " + order.amount + " " + order.fiat + "\n" +
          "Price: " + order.price + "\n" +
          "Status: " + order.status;
        await sendTelegram(message);
      }
    }

    // ===== Price alerts =====
    const prices = await getMarketPrices();
    const buyTarget = await getSetting("buyTarget");
    const sellTarget = await getSetting("sellTarget");

    if (buyTarget && prices.buy.length > 0 && prices.buy[0].price <= parseFloat(buyTarget)) {
      await sendTelegram("📉 <b>Buy Price Alert!</b>\nBest sell price is now ₦" + prices.buy[0].price);
    }

    if (sellTarget && prices.sell.length > 0 && prices.sell[0].price >= parseFloat(sellTarget)) {
      await sendTelegram("📈 <b>Sell Price Alert!</b>\nBest buy price is now ₦" + prices.sell[0].price);
    }

    return { statusCode: 200, body: "Done" };
  } catch (err) {
    await sendTelegram("❌ Function crashed: " + err.message);
    return { statusCode: 500, body: err.message };
  }
};
