# OpenClaw editor-agent — шаблон тестового задания

Каркас Telegram-агента-редактора на [OpenClaw](https://openclaw.ai). Это **GitHub template**:
форкни/«Use this template», допиши логику агента, пришли ссылку на свою ветку — мы развернём и проверим.

Шаблон даёт готовый каркас и подключение конфигурации. **Логику агента писать тебе.**

---

## Что агент должен уметь (целевой поток)

Тема из Telegram → поиск источников (Tavily) → статья со ссылками на реальные источники (OpenRouter) →
черновик в канал с кнопками **[Опубликовать] / [Отклонить]** → доработка по замечанию →
**публикация в канал только после явного согласия человека**.

---

## Что уже сделано (в шаблоне)

- Агент на OpenClaw собирается и стартует одной командой.
- Telegram-бот в режиме **long-polling** (без webhook), один бот + один канал.
- Конфиг — только из переменных окружения (`config.example.json` → `~/.openclaw/openclaw.json` на старте).
- Подключены провайдеры: OpenRouter (модель, формат OpenAI) и Tavily (поиск).
- Модель по умолчанию — **бесплатная** (`qwen/qwen3-next-80b-a3b-instruct:free`): для самотеста хватает бесплатного OpenRouter-ключа, менять модель не требуется.
- `Dockerfile` для деплоя на Railway (см. «Деплой»).
- **Живой пруф каркаса:** бот отвечает на `/start` и эхом на любой текст (`plugins/agent-stub/index.js`) — без вызова модели.

## Что дописываешь ты (кандидат)

Всё помечено `TODO(кандидат)` в [`plugins/agent-stub/index.js`](plugins/agent-stub/index.js):

1. Приём темы из Telegram.
2. Поиск источников через Tavily (`web_search` / `tavily_search`; ключ — `SEARCH_API_KEY`).
3. Генерация статьи со ссылками через OpenRouter (`api.runtime.llm.complete`, формат OpenAI; ключ — `OPENROUTER_API_KEY`).
4. Черновик в канал (`TELEGRAM_CHANNEL_ID`) с inline-кнопками [Опубликовать]/[Отклонить]
   (`registerCommand` + `registerInteractiveHandler`).
5. Доработка по замечанию человека.
6. Публикация в канал **только после согласия** (нажатие кнопки).

> **Важно:** эхо-хук `before_dispatch` в `plugins/agent-stub/index.js` — временная заглушка-пруф. **Удали его**, иначе он перехватит весь входящий текст и твой агент не запустится. Этот файл — твоя рабочая зона; «обвязку» (Dockerfile, `deploy/entrypoint.sh`, имена переменных, способ запуска) не меняй.

## Правила

- **Без хардкода ключей.** Только переменные окружения (`.env.example`), реальные значения не коммитить.
- Статья — на **реальных источниках со ссылками** (не выдумывать факты/URL).
- **Без согласования человека не публиковать** в канал.
- Не менять имена переменных окружения и режим long-polling.

## Как сдавать

1. Создай свой репозиторий из шаблона («Use this template») или форкни.
2. Реализуй логику в отдельной ветке.
3. Пришли **ссылку на ветку** своего репозитория. Доступы/ключи мы не выдаём — проверяем на своей среде.

---

## Переменные окружения

Ровно 4 имени (заданы в среде, не в коде). См. `.env.example`.

| Переменная | Назначение |
|---|---|
| `OPENROUTER_API_KEY` | Ключ OpenRouter (LLM, формат OpenAI) |
| `SEARCH_API_KEY` | Ключ Tavily (поиск). Пробрасывается в `TAVILY_API_KEY` на старте |
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather (long-polling) |
| `TELEGRAM_CHANNEL_ID` | ID канала публикации (бот — админ канала) |

> Токен gateway генерируется автоматически в `deploy/entrypoint.sh` — отдельная переменная не нужна.
> Для эхо-пруфа достаточно `TELEGRAM_BOT_TOKEN` + `OPENROUTER_API_KEY`; `SEARCH_API_KEY`/`TELEGRAM_CHANNEL_ID`
> нужны уже для реальной логики.

## Запуск

Одной командой (нужен установленный `openclaw` и заданные переменные окружения):

```bash
npm start          # = bash deploy/entrypoint.sh
```

## Деплой (Railway)

Образ собирается из **`Dockerfile`** (Railway/nixpacks сам глобальный `openclaw` не ставит — поэтому Dockerfile в шаблоне).
Gateway слушает `$PORT`, выдаваемый Railway. Состояние OpenClaw — `~/.openclaw`
(для устойчивости между рестартами смонтируй persistent-том на `OPENCLAW_STATE_DIR`).

---

## Структура

```
.
├── Dockerfile                     ← сборка образа (Railway)
├── package.json                   ← npm start → entrypoint
├── config.example.json            ← конфиг OpenClaw (без секретов)
├── .env.example                   ← 4 переменные окружения
├── deploy/
│   └── entrypoint.sh              ← готовит ~/.openclaw из env, стартует gateway
└── plugins/
    └── agent-stub/                ← каркасный плагин: эхо-пруф + TODO-пайплайн
        ├── index.js
        ├── openclaw.plugin.json
        └── package.json
```
