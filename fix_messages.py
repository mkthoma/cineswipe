import re

file_path = r'agent\gemini-loop.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    "'Reading your watchlist…'",
    "'Executing MCP tool: manage_watchlist…'"
)
content = content.replace(
    "'Asking Gemini for recommendations…'",
    "'Executing MCP tool: fetch_recommendations…'"
)
content = content.replace(
    "'Fetching poster images…'",
    "'Executing MCP tool: fetch_poster_image…'"
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

file_path2 = r'public\app.js'
with open(file_path2, 'r', encoding='utf-8') as f:
    content2 = f.read()

content2 = content2.replace(
    "label.textContent = `Fetching poster images… (${count}/${total})`;",
    "label.textContent = `Executing MCP tool: fetch_poster_image… (${count}/${total})`;"
)

with open(file_path2, 'w', encoding='utf-8') as f:
    f.write(content2)
