# Reinh Antigravity ACP — Google Antigravity для bb

Плагин-провайдер для [bb](https://github.com/get-bb/bb), который запускает **Google Antigravity** (Gemini 4 Argon, Gemini 3.8 Flash) через официальный ACP-сервер Google.

Это форк [rawizhere/bb-plugin-antigravity-acp](https://github.com/rawizhere/bb-plugin-antigravity-acp). Исходный автор — **rawizhere**, лицензия MIT сохранена. ID плагина и провайдера те же (`google-antigravity-acp` / `acp-antigravity`), поэтому форк заменяет оригинал.

## Что исправлено и добавлено

| | Оригинал 0.2.5 | Этот форк |
|---|---|---|
| Уровни reasoning | в списке один пункт `Argon` или `Flash` | настоящие **Low / Medium / High**, только те, что объявил сервер |
| Смена уровня | не работала | переключается в том же треде, выбранный вариант проверяется до отправки запроса |
| Лимиты в bb | не показывались | **Gemini 4 Argon** и **Flash/Pro** отдельно: неделя и 5 часов, время сброса |
| Режим `accept-edits` | спрашивал подтверждение на каждую правку | правки файлов внутри проекта проходят сами, команды и правки вне проекта спрашиваются |
| Рабочая папка агента | правки могли уйти в `~/.bb/thread-storage` | агент работает в папке проекта |

Подробности в [CHANGELOG.md](CHANGELOG.md).

## Требования

- **bb 0.49.0 или новее** (`bb --version`).
- Аккаунт Google с доступом к Antigravity (проверено на Google AI Pro).
- macOS (проверено на Apple Silicon). Linux и Windows поддерживаются кодом оригинала, но в этом форке не проверялись.

## Установка

### 1. Если у вас стоит оригинальный плагин rawizhere

bb не даёт заменить плагин, установленный из другого git-репозитория. Сначала удалите его:

```bash
bb plugin config google-antigravity-acp
```

```bash
bb plugin remove google-antigravity-acp
```

> `remove` удаляет **настройки плагина** (папки установки и модель по умолчанию). Первая команда показывает их, чтобы при желании вернуть их потом. Вход в Google (`~/.gemini`), установленный ACP-сервер и ваши треды не затрагиваются.

### 2. Установите форк

```bash
bb plugin install git:github.com/reinh2/reinh-antigravity-acp@semver:^0.3.0 --yes
```

bb сам соберёт плагин. Диапазон `^0.3.0` позволяет получать обновления командой `bb plugin update google-antigravity-acp`.

### 3. Установите ACP-сервер Google (если ещё не стоит)

```bash
bb google-antigravity-acp status
```

Если статус не `Ready`, установите сервер:

```bash
bb google-antigravity-acp install
```

### 4. Проверьте

```bash
bb provider models acp-antigravity
```

У обеих моделей должны быть уровни `low, medium, high`. Затем откройте новый тред с провайдером **Google Antigravity** и при первом запуске пройдите вход в Google.

### Лимиты

Откройте в bb экран **Usage**. Там появится карточка Google Antigravity с окнами «Gemini 4 Argon · weekly», «Gemini Flash + Gemini Pro · weekly» и «· 5h». Данные берутся встроенной командой сервера `/usage`: модель не вызывается, токены не тратятся. Ответ обновляется не чаще раза в минуту.

Если у вас стоит сторонний плагин `bb-antigravity-usage`, он покажет вторую карточку Antigravity (у некоторых — с подсказкой входа). Его можно отключить:

```bash
bb plugin disable bb-antigravity-usage
```

## Обновление и откат

Обновить:

```bash
bb plugin update google-antigravity-acp
```

Вернуть оригинал rawizhere:

```bash
bb plugin remove google-antigravity-acp
```

```bash
bb plugin install git:github.com/rawizhere/bb-plugin-antigravity-acp@semver:^0.2.0 --yes
```

## Известные ограничения

- **Первый ответ после запуска плагина бывает долгим** (до ~5 минут). Так же ведёт себя и оригинал; следующие ответы обычно приходят за 15–40 секунд.
- **Лимиты читаются из текстового отчёта `/usage`.** Если Google поменяет его формат, bb покажет ошибку загрузки лимитов, а не неверные цифры.
- **Агент не видит служебную папку bb (`~/.bb/thread-storage`) как рабочую.** Это сделано специально: сервер Google выбирает рабочую папку по алфавиту и иначе писал бы туда вместо проекта. Вложения он читает по полному пути.
- **Модели, у которых уровень мышления задаётся только отдельной настройкой** (а не вариантом модели), пока не запускаются. Gemini 4 Argon и Gemini 3.8 Flash сюда не относятся.

## Как это устроено

- `model-discovery.ts`, `model-utils.ts`, `model-cache.ts` — получение каталога моделей у ACP-сервера, группировка вариантов в «семейство + уровень», кэш.
- `model-bridge.ts` — обёртка моста bb: переводит «модель + уровень» в точный ID варианта ACP; отвечает на запрос лимитов.
- `usage.ts` — запрос `/usage` и разбор отчёта в окна лимитов.
- `vendor/provider-bridge-acp.js` — копия ACP-моста из `@get-bb/plugin-sdk@0.6.132` с патчем [`patches/provider-bridge-acp-0.6.132.patch`](patches/provider-bridge-acp-0.6.132.patch): строгая проверка выбранной модели, защита от гонок, `accept-edits`, рабочая папка. Генерируется воспроизводимо и сверяется по SHA-256 (`patches/acp-runtime-lock.json`).

## Разработка

```bash
npm ci
```

```bash
npm test
```

```bash
npm run test:bundle
```

`npm run build` пересобирает `vendor/` из закреплённого SDK и патча и собирает плагин; `python3 scripts/verify-local.py` прогоняет все проверки разом. Все тесты используют синтетический ACP-сервер и не обращаются к Google.

Подключить локальную копию вместо установленной из git:

```bash
bb plugin remove google-antigravity-acp
```

```bash
bb plugin install path:$PWD --yes
```

## English

Fork of [rawizhere/bb-plugin-antigravity-acp](https://github.com/rawizhere/bb-plugin-antigravity-acp) for [bb](https://github.com/get-bb/bb). It fixes the reasoning picker (real Low/Medium/High instead of `Argon`/`Flash`), applies and verifies the selected variant before every prompt, shows Antigravity quota in bb's Usage panel (Gemini 4 Argon separately from Flash/Pro), makes `accept-edits` approve in-workspace file edits, and keeps the agent's working directory on the project. Requires bb ≥ 0.49.0.

```bash
bb plugin remove google-antigravity-acp
```

```bash
bb plugin install git:github.com/reinh2/reinh-antigravity-acp@semver:^0.3.0 --yes
```

`remove` deletes the plugin's settings (not your Google sign-in or threads).

## Лицензия

MIT — см. [LICENSE](LICENSE). Оригинал © rawizhere. Встроенный ACP-мост — © bb (MIT) и Agent Client Protocol SDK (Apache-2.0), см. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
