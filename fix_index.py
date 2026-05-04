import re

file_path = r'public\index.html'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    '<span class="step-label">Reading your watchlist…</span>',
    '<span class="step-label">Executing MCP tool: manage_watchlist…</span>'
)
content = content.replace(
    '<span class="step-label">Asking Gemini for recommendations…</span>',
    '<span class="step-label">Executing MCP tool: fetch_recommendations…</span>'
)
content = content.replace(
    '<span class="step-label">Fetching poster images…</span>',
    '<span class="step-label">Executing MCP tool: fetch_poster_image…</span>'
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
