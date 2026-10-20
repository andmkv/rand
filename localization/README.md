# Translation files

Randomize USR ships English plus seven translated locales: German, Spanish, French, Japanese, Russian, Serbian (Latin) and Ukrainian. The checked-in locale CSV files are the source for translation updates.

```sh
npm run i18n:export
npm run i18n:import -- ja localization/ja.csv
npm run i18n:check
npm test
```

Translate only the `translation` column. Preserve keys, English source text, placeholders, BASIC syntax, key names, musical notes, asset IDs and intentional spaces. Keep the complete CSV when importing; import validates the whole file before updating generated locale data.

`i18n:check` compares the catalogs with the application locale tables and checks for missing or stale entries, changed placeholders, untranslated copy and lost spacing. Project source and user-authored text are not translated when a user changes the interface language.
