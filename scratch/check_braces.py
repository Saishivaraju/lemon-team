lines = open('api/index.js').readlines()
balance = 0
for i, line in enumerate(lines):
    balance += line.count('{')
    balance -= line.count('}')
    if balance < 0:
        print(f"Negative balance at line {i+1}: {line.strip()}")
        break
print("Final balance:", balance)
