#!/bin/sh

curl -X POST \
  https://purge.jsdelivr.net \
  -H 'cache-control: no-cache' \
  -H 'content-type: application/json' \
  -d '{
"path": [
"/npm/protvista-uniprot@latest/dist/protvista-uniprot.js",
"/npm/protvista-uniprot@latest/dist/protvista-uniprot.js.map"
]
}'