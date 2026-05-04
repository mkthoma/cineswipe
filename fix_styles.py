import re

file_path = r'public\styles.css'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Make text brighter in dark mode
content = content.replace('--text:          #e8e2d4;', '--text:          #fdfcf8;')
content = content.replace('--text-dim:      #6b6355;', '--text-dim:      #b3aa9c;')
content = content.replace('--text-dimmer:   #333028;', '--text-dimmer:   #8a8274;')

# Increase font sizes
content = content.replace('html { font-size: 15px; }', 'html { font-size: 16px; }')

# Fix inputs and selects
content = content.replace('font-size: 0.875rem;', 'font-size: 0.95rem;')
content = content.replace('font-size: 0.7rem;', 'font-size: 0.8rem;')
content = content.replace('font-size: 0.65rem;', 'font-size: 0.75rem;')
content = content.replace('font-size: 0.75rem;', 'font-size: 0.85rem;')
content = content.replace('font-size: 0.8rem;', 'font-size: 0.9rem;')
content = content.replace('font-size: 0.78rem;', 'font-size: 0.88rem;')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
