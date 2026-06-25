// agent-stub — editor-agent на OpenClaw.
//
// Пайплайн: тема → поиск (Tavily) → статья со ссылками (OpenRouter) →
// черновик в канал с кнопками [Опубликовать]/[Отклонить] → доработка по
// замечанию → публикация в канал ТОЛЬКО после явного согласия человека.
//
// Реализация намеренно не зависит от непротестированных частей SDK:
// LLM и поиск вызываются напрямую через fetch (OpenRouter/Tavily REST API),
// взаимодействие с пользователем — через подтверждённые примитивы SDK
// (registerCommand, on("before_dispatch")), кнопки — через текстовые команды
// (см. README плагина в этом же файле ниже), что не требует угадывания
// сигнатур недокументированных хелперов.

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TAVILY_URL = "https://api.tavily.com/search";
const MODEL = "openrouter/free"; // авто-роутер: сам выбирает доступную бесплатную модель
const MODEL_OVERRIDE = process.env.OPENROUTER_MODEL;
const ACTIVE_MODEL = MODEL_OVERRIDE || MODEL;

// ── состояние диалога в памяти на сессию (ключ — chatId/userId) ──
// session = { topic, description, sources, draft, status: "draft"|"published" }
const sessions = new Map();

function getSession(key) {
  if (!sessions.has(key)) sessions.set(key, {});
  return sessions.get(key);
}

// ── поиск источников через Tavily ──
async function searchSources(query) {
  const apiKey = process.env.SEARCH_API_KEY || process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("SEARCH_API_KEY не задан");

  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 6,
      search_depth: "basic",
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((r) => ({
    title: r.title || r.url,
    url: r.url,
    snippet: (r.content || "").slice(0, 600),
  }));
}

// ── генерация статьи через OpenRouter (формат OpenAI) ──
async function generateArticle({ topic, description, sources, feedback, previousDraft }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY не задан");

  const sourcesBlock = sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet}`)
    .join("\n\n");

  const systemPrompt = `Ты — редактор, который пишет статьи для Telegram-канала на основе найденных источников. Напиши статью строго по указанному формату.

Требования к формату ответа:

**[Заголовок статьи]**

[Вступление — 2–3 предложения]

**[Раздел 1]**
[текст]

**[Раздел 2]**
[текст]

**[Раздел 3]**
[текст]

**Вывод**
[итог + практическая мысль]

**Источники:**
- [название] — [URL]

Правила:
- Объём: строго 600–900 слов (без учёта заголовков и списка источников). НЕ превышай 900 слов даже если попросят "длиннее" или "подробнее" — вместо увеличения объёма делай текст более насыщенным по содержанию.
- Тон: профессиональный, без воды.
- Каждый факт или утверждение должны опираться на один из предоставленных источников; ставь ссылку в формате [1], [2] сразу после утверждения.
- Не выдумывай факты и не используй источники, которых нет в списке.
- Без эмодзи и без слов «революционный», «уникальный», «прорывной», «инновационный».
- Если есть замечания к прошлому черновику — учти их полностью.`;

  const userParts = [
    `Тема: ${topic}`,
    description ? `Описание задачи: ${description}` : null,
    `Источники:\n${sourcesBlock}`,
    feedback ? `Замечания к прошлому черновику: ${feedback}` : null,
    previousDraft ? `Прошлый черновик:\n${previousDraft}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ACTIVE_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter вернул пустой ответ");
  return text.trim();
}

// ── публикация в целевой канал (прямой вызов Telegram Bot API,
//    не зависит от внутренних/недокументированных хелперов OpenClaw) ──
async function publishToChannel(text) {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!channelId) throw new Error("TELEGRAM_CHANNEL_ID не задан");
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN не задан");

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: channelId,
      text: truncateForTelegram(text),
    }),
  });

  if (!res.ok) {
    throw new Error(`Telegram sendMessage error ${res.status}: ${await res.text()}`);
  }
}

function draftReplyText(draft) {
  return draft; // кнопки идут отдельным сообщением через sendDraftWithButtons
}

// Telegram ограничивает текст одного сообщения 4096 символами.
const TELEGRAM_TEXT_LIMIT = 4096;

function truncateForTelegram(text) {
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;
  const marker = "\n\n…(сокращено для предпросмотра, полный текст уйдёт при публикации)";
  return text.slice(0, TELEGRAM_TEXT_LIMIT - marker.length) + marker;
}

// ── отправка черновика пользователю с inline-кнопками ──
// callback_data в формате "editor:action" — namespace "editor" обрабатывается
// через registerInteractiveHandler ниже (штатный механизм OpenClaw для кнопок).
async function sendDraftWithButtons(chatId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN не задан");

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: truncateForTelegram(text),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Опубликовать", callback_data: "editor:publish" },
            { text: "✏️ Отклонить", callback_data: "editor:reject" },
          ],
        ],
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Telegram sendMessage(buttons) error ${res.status}: ${await res.text()}`);
  }
}

// ── ответ на callback_query, чтобы у Telegram не висели "часики" на кнопке ──
async function answerCallbackQuery(callbackQueryId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !callbackQueryId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch {
    // best-effort, не критично если не получилось
  }
}

export default definePluginEntry({
  id: "agentstub",
  name: "OpenClaw Editor Agent",
  description: "Editor-agent: тема → поиск → статья → согласование → публикация",
  register(api) {
    api.registerCommand({
      name: "start",
      description: "Запустить бота",
      acceptsArgs: false,
      requireAuth: false,
      handler: () => ({
        text:
          "Привет! Я агент-редактор статей.\n" +
          "Напиши тему статьи (можно с коротким описанием) — я найду источники и пришлю черновик.\n" +
          "После черновика можно ответить:\n" +
          "  • «опубликовать» — выложить статью в канал\n" +
          "  • «отклонить: <замечание>» — получить новый черновик с учётом правки",
        continueAgent: false,
      }),
    });

    // ── обработка нажатий inline-кнопок через штатный механизм OpenClaw ──
    if (typeof api.registerInteractiveHandler === "function") {
      api.registerInteractiveHandler({
        channel: "telegram",
        namespace: "editor",
        handler: async (ctx) => {
          const action = ctx?.callback?.payload;
          const chatId =
            ctx?.callback?.chatId ??
            ctx?.chatId ??
            ctx?.senderId ??
            ctx?.userId ??
            "default";
          const sessionKey = String(chatId);
          const session = getSession(sessionKey);
          const callbackQueryId = ctx?.callback?.id ?? ctx?.callbackQueryId ?? null;

          try {
            if (action === "publish") {
              if (!session.draft) {
                await answerCallbackQuery(callbackQueryId, "Нет черновика для публикации");
                return { text: "Сначала нужна тема — нет черновика для публикации." };
              }
              await publishToChannel(session.draft);
              session.status = "published";
              await answerCallbackQuery(callbackQueryId, "Опубликовано");
              return { text: "Опубликовано в канал." };
            }

            if (action === "reject") {
              if (!session.draft) {
                await answerCallbackQuery(callbackQueryId, "Нет черновика");
                return { text: "Нет черновика, который можно отклонить." };
              }
              session.awaitingFeedback = true;
              await answerCallbackQuery(callbackQueryId, "Жду замечание");
              return { text: "Напишите замечание — что исправить в статье." };
            }

            await answerCallbackQuery(callbackQueryId, null);
            return { text: "Неизвестное действие." };
          } catch (err) {
            api.logger?.error?.(`agentstub callback error: ${err?.message || err}`);
            return { text: `Ошибка: ${err?.message || err}` };
          }
        },
      });
      api.logger?.info?.("agentstub: registerInteractiveHandler зарегистрирован (namespace=editor)");
    } else {
      api.logger?.warn?.("agentstub: api.registerInteractiveHandler отсутствует в этой версии SDK!");
    }

    // ── обычный текстовый ввод: тема статьи или замечание после "Отклонить" ──
    api.on("before_dispatch", async (event, ctx) => {
      const text = String(event?.content ?? event?.body ?? "").trim();
      if (!text || text.startsWith("/")) return; // команды и пустое — мимо

      const sessionKey = String(
        event?.senderId ?? event?.chatId ?? event?.userId ?? ctx?.sessionKey ?? "default"
      );
      const chatId = event?.senderId ?? event?.chatId ?? event?.userId ?? sessionKey;
      const session = getSession(sessionKey);

      try {
        // ── замечание к черновику (после нажатия "Отклонить") ──
        if (session.awaitingFeedback) {
          session.awaitingFeedback = false;
          const newDraft = await generateArticle({
            topic: session.topic,
            description: session.description,
            sources: session.sources,
            feedback: text,
            previousDraft: session.draft,
          });
          session.draft = newDraft;
          await sendDraftWithButtons(chatId, newDraft);
          return { handled: true, text: "" };
        }

        // ── новая тема ──
        session.topic = text;
        session.description = "";
        session.draft = null;
        session.status = "draft";
        session.awaitingFeedback = false;

        const sources = await searchSources(text);
        if (sources.length === 0) {
          return {
            handled: true,
            text: "Не нашлось источников по теме — попробуйте сформулировать иначе.",
          };
        }
        session.sources = sources;

        const draft = await generateArticle({ topic: text, description: "", sources });
        session.draft = draft;

        await sendDraftWithButtons(chatId, draft);
        return { handled: true, text: "" };
      } catch (err) {
        api.logger?.error?.(`agentstub error: ${err?.message || err}`);
        return {
          handled: true,
          text: `Ошибка при обработке запроса: ${err?.message || err}`,
        };
      }
    });
  },
});
