import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const {
      type, timeframe, direction, entry, sl, tp,
      cycle, price, tpNum, tp: tpPrice, progress,
    } = body;

    const validTypes = ["entry", "tp", "sl", "alldone", "test"];
    if (!validTypes.includes(type)) {
      return new Response(
        JSON.stringify({ error: `Unknown alert type: ${type}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let message = "";
    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour12: false });

    if (type === "entry") {
      const dirEmoji = direction === "buy" ? "🟢" : "🔴";
      const dirText = direction === "buy" ? "BUY (LONG)" : "SELL (SHORT)";
      message = [
        `${dirEmoji} *XAU OVERDRIVE — ENTRY SIGNAL*`,
        `⏰ ${now}`,
        ``,
        `📊 Timeframe: *${timeframe}*`,
        `📈 Direction: *${dirText}*`,
        `🔄 Cycle: #${cycle}`,
        ``,
        `💰 Entry: *${Number(entry).toFixed(2)}*`,
        `🛑 SL: *${Number(sl).toFixed(2)}*`,
        ``,
        `🎯 Take Profits:`,
        `  TP1 (1R): ${Number(tp?.tp1).toFixed(2)}`,
        `  TP2 (2R): ${Number(tp?.tp2).toFixed(2)}`,
        `  TP3 (3R): ${Number(tp?.tp3).toFixed(2)}`,
        `  TP4 (5R): ${Number(tp?.tp4).toFixed(2)}`,
        `  TP5 (8R): ${Number(tp?.tp5).toFixed(2)}`,
        ``,
        `💵 Live Price: ${Number(price).toFixed(2)}`,
        ``,
        `_EMA 9/21 Crossover Detected_`,
      ].join("\n");
    } else if (type === "tp") {
      message = [
        `✅ *XAU OVERDRIVE — TP${tpNum} HIT*`,
        `⏰ ${now}`,
        ``,
        `📊 Timeframe: *${timeframe}*`,
        `🎯 TP${tpNum}: *${Number(tpPrice).toFixed(2)}*`,
        `💵 Price: ${Number(price).toFixed(2)}`,
        `🔥 Progress: ${progress}/5 TPs`,
        ``,
        progress >= 5 ? `🎉 ALL TPs DONE!` : `⏳ Waiting for TP${progress + 1}...`,
      ].join("\n");
    } else if (type === "sl") {
      message = [
        `🛑 *XAU OVERDRIVE — STOP LOSS HIT*`,
        `⏰ ${now}`,
        ``,
        `📊 Timeframe: *${timeframe}*`,
        `🛑 SL: *${Number(sl).toFixed(2)}*`,
        `💰 Entry was: ${Number(entry).toFixed(2)}`,
        `💵 Price: ${Number(price).toFixed(2)}`,
        ``,
        `⏳ Waiting for next EMA 9/21 crossover...`,
      ].join("\n");
    } else if (type === "alldone") {
      message = [
        `🎉 *XAU OVERDRIVE — ALL TPs COMPLETED!*`,
        `⏰ ${now}`,
        ``,
        `📊 Timeframe: *${timeframe}*`,
        `💰 Entry: ${Number(entry).toFixed(2)}`,
        `🔄 Cycle: #${cycle}`,
        `💵 Price: ${Number(price).toFixed(2)}`,
        ``,
        `🏆 5/5 Take Profits hit!`,
        `⏳ Waiting for next EMA 9/21 crossover...`,
      ].join("\n");
    } else if (type === "test") {
      message = [
        `🧪 *XAU OVERDRIVE — TEST ALERT*`,
        `⏰ ${now}`,
        ``,
        `✅ Backend is working!`,
        `📊 Timeframe: ${timeframe || "N/A"}`,
      ].join("\n");
    }

    // Save alert to entity — automation picks it up for WhatsApp
    let alertId = null;
    let saveError = null;

    try {
      const base44 = createClientFromRequest(req);
      const alert = await base44.asServiceRole.entities.Alert.create({
        type,
        timeframe: timeframe || null,
        direction: direction || null,
        entry: entry || null,
        sl: sl || null,
        tp: tp || null,
        cycle: cycle || null,
        price: price || null,
        tpNum: tpNum || null,
        tpPrice: tpPrice || null,
        progress: progress || null,
        sent: false,
      });
      alertId = (alert as any).id;
    } catch (e) {
      saveError = e.message || String(e);
    }

    return new Response(
      JSON.stringify({
        success: !!alertId,
        alertId,
        type,
        timeframe,
        message,
        saveError: alertId ? undefined : saveError,
        timestamp: now,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message || "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
