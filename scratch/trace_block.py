import sys
lines = open('api/index.js').readlines()
balance = 0
in_report = False
for i, line in enumerate(lines):
    if "else if (type === 'end-of-call-report') {" in line:
        in_report = True
        balance = 1
        continue
    if not in_report: continue
    diff = line.count('{') - line.count('}')
    balance += diff
    if i+1 == 3721:
        print(f"Balance at 3721 is: {balance}")
        break
