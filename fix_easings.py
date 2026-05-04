import re

files = ['public/app.js', 'public/views/onboarding.js', 'public/views/swipe.js', 'public/views/prefab.js']

for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Fix animate() that were missed
    content = re.sub(r'animate\(\s*([^,]+),\s*\{', r'anime({ targets: \1,', content)
    
    # Fix easings
    content = content.replace("'outCubic'", "'easeOutCubic'")
    content = content.replace("'inQuad'", "'easeInQuad'")
    content = content.replace("'inCubic'", "'easeInCubic'")
    content = content.replace("'inOutSine'", "'easeInOutSine'")
    
    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)
