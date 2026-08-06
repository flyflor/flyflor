Ask the user one or more focused questions when the current focus cannot proceed without information that the workspace does not provide.

Use this only for real missing decisions or details. You may raise 1 to n questions in a single call; keep each question short and non-overlapping. For each question, provide up to three concrete answer directions as options, and you may mark at most one option as the recommended direction. Do not write an "other" option yourself — the tool always appends a final free-input "other" choice so the user can write their own answer, which may reference the directions you offered.

Each option is `{ label, description?, recommended? }`. Keep labels terse and descriptions concrete.
