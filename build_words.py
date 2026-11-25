"""Build words.json (English-letter Telugu movie titles) from data/TeluguMovies_dataset.csv"""
import csv, json, re, os
base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows = list(csv.DictReader(open(os.path.join(base, 'data', 'TeluguMovies_dataset.csv'), encoding='utf-8')))

def alnum(s): return re.sub(r'[^a-z0-9]', '', s.lower())

def display_and_answers(t):
    t = re.sub(r'\s+', ' ', t).strip()
    answers = {t}
    disp = t
    m = re.match(r'^(.*?)\s*\((.*)\)\s*$', t)
    if m and len(alnum(m.group(1))) >= 3:
        disp = m.group(1).strip()
    if ':' in disp:
        pre, post = [x.strip() for x in disp.split(':', 1)]
        if len(alnum(pre)) >= 4 and len(post.split()) >= 2:
            disp = pre
    m = re.match(r'^(\d+)\s*-\s*(.+)$', disp)
    if m:
        answers.add(disp)
        disp = m.group(2).strip()
    answers.add(disp)
    return disp, sorted(answers)

seen, out = set(), []
for r in rows:
    t = r['Movie'].strip()
    if not t or not re.fullmatch(r'[\x20-\x7e]+', t): continue
    disp, answers = display_and_answers(t)
    n = alnum(disp)
    if len(n) < 3 or n.isdigit() or len(n) > 26 or n in seen: continue
    seen.add(n)
    try: votes = int(float((r['No.of.Ratings'] or '0').replace(',', '')))
    except ValueError: votes = 0
    out.append({'word': disp, 'answers': answers, 'votes': votes, 'year': int(float(r['Year'])) if r['Year'] else None})

out.sort(key=lambda w: -w['votes'])
n = len(out)
for i, w in enumerate(out):
    w['tier'] = 'easy' if i < n * 0.33 else ('medium' if i < n * 0.66 else 'hard')
    del w['votes']
json.dump(out, open(os.path.join(base, 'words.json'), 'w'), ensure_ascii=True, indent=0)
print(n, 'words;', {t: sum(1 for w in out if w['tier'] == t) for t in ('easy', 'medium', 'hard')})
print([w['word'] for w in out[:12]]); print([w['word'] for w in out[-8:]])
