import os

files = ['public/app.js', 'public/views/onboarding.js', 'public/views/swipe.js', 'public/views/prefab.js']

for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Remove backslashes before single quotes
    content = content.replace("\\'", "'")
    
    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)
