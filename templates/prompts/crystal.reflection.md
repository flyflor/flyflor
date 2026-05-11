Extract only reusable method knowledge from the provided evidence.

Return a JSON array. Each item should have: title, method, symbols, bucketHint, coordinates.
Do not use fixed taxonomies. Create symbols and bucketHint from the evidence itself.
When the evidence is not reusable or not verified, return an empty array [].

Evidence:
{{evidence}}
