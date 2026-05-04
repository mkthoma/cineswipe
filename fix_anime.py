import os
import re

files = ['public/app.js', 'public/views/onboarding.js', 'public/views/swipe.js', 'public/views/prefab.js']

for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Imports
    content = content.replace("import { animate, stagger, createTimeline } from '/lib/anime.js';", "import anime from '/lib/anime.js';")
    content = content.replace("import { animate, stagger } from '/lib/anime.js';", "import anime from '/lib/anime.js';")
    
    # Calls
    # animate(TARGET, { ... }) -> anime({ targets: TARGET, ... })
    content = re.sub(r'animate\(\s*([^,]+),\s*\{', r'anime({ targets: \1,', content)
    
    # Some animate calls might not have the { right after TARGET, e.g. animate(counter, { value: ... }) 
    # But the regex animate\(\s*([^,]+),\s*\{ handles that.
    
    # ease: -> easing:
    content = re.sub(r'\bease:\s*\'([^\']+)\'', r'easing: \'\1\'', content)
    
    # stagger( -> anime.stagger(
    content = re.sub(r'(?<!\.)\bstagger\(', r'anime.stagger(', content)
    
    # createTimeline( -> anime.timeline(
    content = re.sub(r'\bcreateTimeline\(', r'anime.timeline(', content)
    
    # Convert ease names to v3 format if they are like outCubic -> easeOutCubic
    content = content.replace("'outCubic'", "'easeOutCubic'")
    content = content.replace("'inQuad'", "'easeInQuad'")
    content = content.replace("'inCubic'", "'easeInCubic'")
    content = content.replace("'inOutSine'", "'easeInOutSine'")
    
    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)
