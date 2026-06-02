html_to_insert = """
      <div class="panel" id="panel-call-logs">
        <div class="sec-head">
          <div class="sec-title">AI Call Logs</div>
          <button class="btn btn-primary btn-sm" onclick="fetchCallLogs()"><i class="fas fa-sync"></i> Refresh Logs</button>
        </div>
        <div class="card" style="margin-top:20px;">
          <div class="card-body">
            <table class="data-table" style="width:100%; text-align:left;">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Lead Name</th>
                  <th>Outcome</th>
                  <th>Duration</th>
                  <th>Reason</th>
                  <th>Action Needed</th>
                </tr>
              </thead>
              <tbody id="call-logs-tbody">
                <tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Loading call logs...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="panel" id="panel-retry-queue">
        <div class="sec-head">
          <div class="sec-title">AI Retry Queue</div>
          <button class="btn btn-primary btn-sm" onclick="fetchRetryQueue()"><i class="fas fa-sync"></i> Refresh Queue</button>
        </div>
        <div class="card" style="margin-top:20px;">
          <div class="card-body">
            <table class="data-table" style="width:100%; text-align:left;">
              <thead>
                <tr>
                  <th>Scheduled Time</th>
                  <th>Lead Details</th>
                  <th>Source</th>
                  <th>Attempt</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="retry-queue-tbody">
                <tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px;">Loading retry queue...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
"""

with open('zorvo_dashboard.html', 'r') as f:
    lines = f.readlines()

end_settings = -1
for i, l in enumerate(lines):
    if 'id="panel-settings"' in l:
        depth = 0
        for j in range(i, len(lines)):
            depth += lines[j].count('<div') - lines[j].count('</div')
            if depth <= 0 and j > i:
                end_settings = j
                break
        break

if end_settings != -1:
    lines.insert(end_settings + 1, html_to_insert)
    with open('zorvo_dashboard.html', 'w') as f:
        f.writelines(lines)
    print("Panels inserted.")
else:
    print("Could not find panel-settings end.")
