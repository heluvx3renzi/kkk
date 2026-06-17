// agent-stub — каркасный плагин editor-агента на OpenClaw.
//
// ЖИВОЕ (доказывает, что каркас работает, БЕЗ вызова модели):
//   - команда /start — приветствие;
//   - эхо на любое входящее сообщение через хук before_dispatch.
//
// TODO(кандидат) — пайплайн агента: см. блок в конце register().
// Логика намеренно НЕ реализована: это и оценивается у кандидата.

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "agentstub",
  name: "OpenClaw Editor Agent (template)",
  description: "Skeleton editor-agent: живой echo-пруф + TODO-заглушки пайплайна",
  register(api) {
    // ── ЖИВОЕ: /start — приветствие, мимо LLM ──
    api.registerCommand({
      name: "start",
      description: "Запустить бота",
      acceptsArgs: false,
      requireAuth: false,
      handler: () => ({
        text:
          "OpenClaw editor-agent (шаблон). Каркас рабочий: пришли любой текст — отвечу эхом.\n" +
          "Логику агента дописывает кандидат — см. README и TODO в plugins/agent-stub/index.js.",
        continueAgent: false,
      }),
    });

    // ── ЖИВОЕ: эхо на любое входящее — доказывает long-polling и обработку без LLM ──
    //    TODO(кандидат): удали этот эхо-хук, когда подключишь реальный пайплайн ниже.
    api.on("before_dispatch", async (event /*, ctx */) => {
      const text = String(event?.content ?? event?.body ?? "").trim();
      if (!text || text.startsWith("/")) return; // команды и пустое — мимо
      return { handled: true, text: `echo: ${text}` };
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TODO(кандидат): реализовать пайплайн editor-агента.
    // Ничего из этого в шаблоне не реализовано НАМЕРЕННО.
    //
    //   1. Приём темы из Telegram (текст пользователя).
    //   2. Поиск источников через Tavily.
    //      Ключ: process.env.SEARCH_API_KEY (entrypoint пробрасывает его в TAVILY_API_KEY,
    //      который читает нативный tavily-плагин). Инструменты: web_search / tavily_search.
    //   3. Генерация статьи СО ССЫЛКАМИ на реальные источники через OpenRouter
    //      (api.runtime.llm.complete(...), формат OpenAI). Ключ: OPENROUTER_API_KEY.
    //   4. Публикация ЧЕРНОВИКА в канал (process.env.TELEGRAM_CHANNEL_ID) с inline-кнопками
    //      [Опубликовать] / [Отклонить]:
    //        - кнопки: registerCommand -> presentation.blocks ({type:"buttons", buttons:[...]}),
    //        - нажатия: api.registerInteractiveHandler({channel:"telegram", namespace, handler}).
    //   5. Доработка статьи по замечанию человека.
    //   6. Публикация в канал ТОЛЬКО после явного согласия человека (нажатие кнопки).
    //
    // Правила (см. README): без хардкода ключей; ссылки на реальные источники;
    // без согласования не публиковать.
    // ─────────────────────────────────────────────────────────────────────────
  },
});
