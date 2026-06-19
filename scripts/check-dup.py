import json

with open('src/locales/en-US.json') as f:
    content = f.read()

def parse_with_duplicate_detection(s):
    pos = 0
    
    def skip_whitespace():
        nonlocal pos
        while pos < len(s) and s[pos] in ' \t\n\r':
            pos += 1
    
    def parse_value(path):
        nonlocal pos
        skip_whitespace()
        if s[pos] == '{':
            return parse_object(path)
        elif s[pos] == '[':
            return parse_array(path)
        elif s[pos] in '\'"':
            return parse_string()
        else:
            start = pos
            while pos < len(s) and s[pos] not in ',}] \t\n\r':
                pos += 1
            return s[start:pos]
    
    def parse_string():
        nonlocal pos
        quote = s[pos]
        pos += 1
        start = pos
        while pos < len(s) and s[pos] != quote:
            if s[pos] == '\\':
                pos += 2
            else:
                pos += 1
        result = s[start:pos]
        pos += 1
        return result
    
    def parse_object(path):
        nonlocal pos
        pos += 1
        keys = set()
        while True:
            skip_whitespace()
            if s[pos] == '}':
                pos += 1
                break
            key = parse_string()
            skip_whitespace()
            assert s[pos] == ':'
            pos += 1
            if key in keys:
                print(f'DUPLICATE KEY at path {path}: {key}')
            keys.add(key)
            parse_value(path + '.' + key)
            skip_whitespace()
            if s[pos] == ',':
                pos += 1
                continue
            elif s[pos] == '}':
                pos += 1
                break
    
    def parse_array(path):
        nonlocal pos
        pos += 1
        while True:
            skip_whitespace()
            if s[pos] == ']':
                pos += 1
                break
            parse_value(path + '[]')
            skip_whitespace()
            if s[pos] == ',':
                pos += 1
                continue
            elif s[pos] == ']':
                pos += 1
                break
    
    parse_value('')

parse_with_duplicate_detection(content)
