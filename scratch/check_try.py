lines = open('api/index.js').readlines()
balance = 0
for i, line in enumerate(lines):
    if i < 2570: continue
    if i > 3750: break
    balance += line.count('try {')
    balance -= line.count('catch (')
    if balance < 0:
        print(f"Negative balance at line {i+1}: {line.strip()}")
print("Final try balance:", balance)
