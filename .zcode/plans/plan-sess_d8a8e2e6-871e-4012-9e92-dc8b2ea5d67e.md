## План: улучшение блока хранилища OPFS (тексты + обработка отказа persist + убрать авто-persist)

### Контекст
- «10 ГБ» — не лимит приложения, а квота origin'а, которую отдаёт браузер через `navigator.storage.estimate().quota`. Увеличить вручную нельзя.
- Кнопка «Сделать постоянным» вызывает `navigator.storage.persist()` — защищает OPFS от авто-вытеснения. Обратного API нет.
- Сейчас `requestPersistentStorage()` дёргается автоматически при открытии веб-воркспейса (`web.ts:30`) — нужно убрать; persist должен включаться только вручную из настроек.
- Отказ persist сейчас проглатывается молча — нужно показывать пользователю.

### Изменения

#### 1. `src/stores/workspace/provider/web.ts` — убрать авто-persist
- Удалить импорт `requestPersistentStorage` (стр. 2).
- Удалить строки 28-30 (комментарий + `void requestPersistentStorage();`) из `restoreWorkspace()`.
- Функция остаётся fire-and-forget-безопасной по своей природе (persist больше не вызывается при открытии).

#### 2. `src/composables/useStoragePersistence.ts` — пробросить состояние отказа
- Добавить `isPersistSupported` — вычисляется один раз: `typeof navigator.storage?.persist === 'function'` (отдельно от `isSupported`, который проверяет весь StorageManager).
- Добавить реактивный `persistDeclined: Ref<boolean>` (по умолчанию `false`). В `requestPersist()`: сбрасывать в `false` в начале, ставить `true` если `requestPersistentStorage()` вернул `false` (явный отказ браузера), оставлять `false` при `true`/`null`.
- Добавить в возвращаемый объект `isPersistSupported` и `persistDeclined: readonly(...)`.

#### 3. `src/components/settings/SettingsStorage.vue` — UI состояний и подсказки
- Деструктурировать новые `isPersistSupported`, `persistDeclined` из composable.
- Импортировать `UiAlert` (существующий компонент `~/components/ui/UiAlert.vue`).
- Добавить `UiAlert` (info) под полосой использования с пояснением о природе квоты (`quotaHint`).
- Логика строки persist:
  - если `!isPersistSupported` → `UiAlert` (warning) «не поддерживается этим браузером», без кнопки;
  - иначе если `isPersisted` → текущая иконка замка + `persistedOn`;
  - иначе → иконка открытого замка + кнопка «Сделать постоянным».
- Если `persistDeclined` → `UiAlert` (warning) «браузер отклонил запрос» после кнопки.
- Добавить `UiAlert` (info) с `persistHint` о необратимости рядом с кнопкой.

#### 4. Локали (`src/locales/ru-RU.json` и `en-US.json`, ключ `videoEditor.settings.browserStorage`) — обновить и дополнить
Обновить существующие:
- `description` — пояснить природу квоты (хранилище OPFS, объём задаёт браузер).
- `persistedOff` / `persistedOn` — сделать точнее.

Добавить новые ключи (в оба файла, в алфавитном порядке):
- `quotaHint` — квоту определяет браузер от свободного места, вручную не увеличить; persist и освобождение диска могут поднять потолок.
- `persistHint` — что делает persist, и что обратного отключения нет (только очистка данных сайта).
- `persistUnsupported` — постоянное хранение не поддерживается этим браузером/режимом.
- `persistDeclined` — браузер отклонил запрос (например, приватный режим).

⚠️ Тест `test/unit/locales/parity.test.ts` требует идентичного набора ключей в обоих файлах — добавлять в оба симметрично.

#### 5. Тесты
- `test/unit/composables/useStoragePersistence.test.ts`: добавить проверки — `isPersistSupported` true/false; `requestPersist()` ставит `persistDeclined=true` когда persist() вернул `false`; сбрасывает в `false` при успехе.
- `test/components/settings/SettingsStorage.spec.ts`: расширить mock composable новыми refs; добавить тесты — рендерится `UiAlert`-предупреждение когда persist не поддерживается; рендерится alert-об отказе когда `persistDeclined=true`.
- `test/unit/stores/workspace/provider/web.test.ts`: убедиться, что после удаления вызова `navigator.storage.persist` не вызывается при `restoreWorkspace()` (добавить stub `persist` + assertion `not.toHaveBeenCalled`).

### Файлы (всего 7 правок + 2 теста)
1. `src/stores/workspace/provider/web.ts`
2. `src/composables/useStoragePersistence.ts`
3. `src/components/settings/SettingsStorage.vue`
4. `src/locales/ru-RU.json`
5. `src/locales/en-US.json`
6. `test/unit/composables/useStoragePersistence.test.ts`
7. `test/components/settings/SettingsStorage.spec.ts`
8. `test/unit/stores/workspace/provider/web.test.ts`

### Поведение, которое НЕ меняется
- `requestPersistentStorage()` по-прежнему best-effort и safe в неподдерживаемых средах.
- Кнопка по-прежнему прячется при `isPersisted`.
- Десктопный (Tauri) блок настроек путей не затрагивается.
- DB-схемы/миграции/API — не трогаются.

### Проверка
- `pnpm test:unit` (юниты composable + locales parity + web provider)
- `pnpm test:unit` (компонент-спека) — через тот же запуск
- Линт/тайпчек при необходимости