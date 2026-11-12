# Changelog

## 0.3.2 — 2026-11-12

- Установщик ставит **agy-acp-server 1.4.5** (было 1.1.1). Старый сервер отправлял личные аккаунты на устаревший endpoint Google и получал `502 Bad Gateway: Failed to connect to backend API`.
- Поддержка **Intel Mac** (`darwin-x86_64`): раньше установка там падала «нет дистрибутива».
- Скачанный архив сервера проверяется по SHA-256 из реестра ACP.

## 0.3.1 — 2026-11-11

- Windows: установка сервера больше не падает с «No Antigravity ACP distribution for win32» (ключ платформы `win32` → `windows`, как в реестре ACP). Ошибка была и в оригинале.
- Windows: путь с апострофом (`C:\Users\O'Brien`) не ломает распаковку через PowerShell.
- Windows: короткие запросы к серверу (каталог моделей, лимиты, проверка установки) завершают всё дерево процессов (`taskkill /T`), а не только `agy_acp_server.exe`; раньше `localharness_external.exe` оставался висеть.
- Тесты и харнесс работают на Windows; `.gitattributes` фиксирует LF для файлов, сверяемых по SHA-256.
- CI: Linux x64/arm64, Windows, macOS — тесты и установка настоящего ACP-сервера Google с проверкой handshake.

## 0.3.0 — 2026-11-11

Первый публичный релиз форка.

- Экран Usage в bb: плагин стал источником `provider-usage.v1` (Argon и Flash/Pro отдельно).

## 0.2.6-reinh.1 — 2026-11-11 (локальный prerelease)

- Исправлено предпочтение валидных ACP variant roster перед семейными config options.
- Убрано распознавание произвольных ID-суффиксов/метаданных имени как reasoning; значения ограничены протоколом bb.
- Добавлена точная маршрутизация семейство/уровень → существующий ACP ID, без вымышленных fallback-моделей.
- Сохранены legacy варианты, opaque ID и доступные default-настройки.
- Добавлены typed auth recovery, cached-token handshake, ограниченный lifecycle discovery и launch-scoped атомарный кэш v2.
- Защищены отменённые start и изменённые turn от неправильной модели.
- Config-only reasoning заблокирован до строгой обработки ошибок в shared ACP bridge; последовательное прямое переключение turn и grouped options проверены на SDK 0.6.132.
- SDK обновлён до согласованного с bb `0.6.132`, engine requirements выровнены.
- Upstream defects SDK (roster drift, concurrent turn admission, подавление отказа thinking) исправлены vendored runtime `reinh-acp-strict-2`, собираемым из закреплённого SDK и проверенного патча.
- strict-2: принимается ответ Antigravity, раскладывающий variant ID на `model` + `thinking_level` (найдено в живой приёмке).
- Режим accept-edits исправлен (runtime `reinh-acp-strict-3`): правки файлов внутри workspace-корней треда одобряются автоматически; правки за их пределами (включая `../`), относительные пути и команды по-прежнему требуют подтверждения.
- Antigravity больше не получает `additionalDirectories`: сервер сортирует рабочие папки и брал `~/.bb/thread-storage` вместо проекта, поэтому правки уходили не туда. Корни записи остаются в политике разрешений bb.
- Лимиты использования в bb (`provider/usage`): квота читается встроенной командой сервера `/usage` (без вызова модели и расхода токенов). Gemini 4 Argon и группа Flash/Pro показываются отдельными окнами (неделя / 5 часов) с привязкой к семейству модели; группы Claude/GPT не показываются. Ответ кэшируется на 60 с.
- Конфликтующие model/thinking sessionOptions не могут переопределить выбранный вариант.
- Добавлены regression, subprocess integration, build-artifact проверки и синтетические материалы для видео.
- Подготовлены QA/review и обратимая path-установка с сохранением plugin/provider ID; публикация и установка не выполнялись.
- Zod обновлён с upstream диапазона `^4.3.6` до `^4.6.7` в исходном пользовательском патче; изменение сохранено.

## 0.2.5 и предшествующие версии

Исходный плагин rawizhere, MIT. Установленный оригинальный release: `ca96249895a2e473f07b46f28c92768d88bcea5b`. Рабочий checkout также включает upstream-коммиты до `7279c770e2dfe4d15c69921220d554a3eb996384`, в том числе локализацию launch spec и Linux `--uid=`. Они не приписываются Reinh.
