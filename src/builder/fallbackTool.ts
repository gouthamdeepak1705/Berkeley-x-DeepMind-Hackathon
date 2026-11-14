import { RefundRecord } from '../types/domain';

export function isFlaggedRefundRecord(r: RefundRecord): boolean {
  return (
    r.method === 'cash' &&
    r.time >= '20:00' &&
    !r.linkedOrder &&
    r.till === 2 &&
    r.operatorNumber === 14
  );
}

export const FALLBACK_REFUND_DESK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Refund exceptions desk — Walnut Creek</title>
  <style>
    :root {
      --bg: #FAF8F5;
      --surface: #FFFFFF;
      --border: #E6E1D8;
      --ink: #171717;
      --muted: #57534E;
      --subtle: #78716C;
      --indigo: #312E81;
      --amber: #B45309;
      --amber-bg: #FFFBEB;
      --amber-border: #FDE68A;
      --green: #15803D;
      --green-bg: #ECFDF5;
      --green-border: #BBF7D0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--ink);
      font-size: 13px;
      line-height: 1.45;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
    }
    h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .sub {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--subtle);
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 12px;
    }
    .stat {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
    }
    .stat-label {
      font-size: 11px;
      color: var(--subtle);
    }
    .stat-val {
      font-size: 15px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      margin-top: 2px;
    }
    .stat-val.amber { color: var(--amber); }
    .switch-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .switch-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--ink);
      cursor: pointer;
    }
    .switch-note {
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
    }
    .toggle-btn {
      position: relative;
      width: 44px;
      height: 24px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: #D6D3D1;
      cursor: pointer;
      flex-shrink: 0;
      padding: 0;
      transition: background 150ms ease;
    }
    .toggle-btn[aria-checked="true"] {
      background: var(--indigo);
      border-color: var(--indigo);
    }
    .toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #FFFFFF;
      transition: transform 150ms ease;
    }
    .toggle-btn[aria-checked="true"] .toggle-knob {
      transform: translateX(20px);
    }
    .tabs {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #F3F0EA;
      padding: 2px;
      margin-bottom: 10px;
    }
    .tab-btn {
      border: none;
      background: transparent;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      border-radius: 6px;
      cursor: pointer;
    }
    .tab-btn.active {
      background: var(--surface);
      color: var(--ink);
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .row-item {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      background: var(--surface);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .row-item.flagged {
      background: var(--amber-bg);
      border-color: var(--amber-border);
    }
    .row-item.reviewed {
      background: var(--green-bg);
      border-color: var(--green-border);
    }
    .row-meta {
      font-size: 11px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .row-amt {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      font-size: 13px;
    }
    .tag {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 4px;
      margin-left: 6px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .tag-flag { background: #FEF3C7; color: #92400E; }
    .tag-ok { background: #DCFCE7; color: #166534; }
    .rev-btn {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--ink);
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }
    .rev-btn.done {
      border-color: var(--green-border);
      color: var(--green);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header-row">
      <div>
        <h1 id="store-title">Walnut Creek — Refund exceptions desk</h1>
        <p class="sub">Last 35 days of store refund entries</p>
      </div>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Flagged entries</div>
        <div class="stat-val amber" id="flagged-count">0</div>
      </div>
      <div class="stat">
        <div class="stat-label">Flagged total</div>
        <div class="stat-val" id="flagged-total">$0</div>
      </div>
      <div class="stat">
        <div class="stat-label">Unreviewed</div>
        <div class="stat-val" id="unreviewed-count">0</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="switch-box">
      <div>
        <label class="switch-label" for="approval-switch" id="switch-text">
          Require manager approval for cash refunds over $50 at this store
        </label>
        <div class="switch-note" id="switch-note">Currently off. Turning on passes through the owner gateway.</div>
      </div>
      <button
        type="button"
        id="approval-switch"
        class="toggle-btn"
        role="switch"
        aria-checked="false"
        aria-labelledby="switch-text"
      >
        <span class="toggle-knob"></span>
      </button>
    </div>
  </div>

  <div class="card">
    <div class="tabs" role="tablist">
      <button type="button" class="tab-btn active" id="tab-flagged">Flagged only</button>
      <button type="button" class="tab-btn" id="tab-all">All 35 days</button>
    </div>
    <div id="rows-container" class="rows"></div>
  </div>

  <script>
    (function () {
      var state = {
        storeName: 'Walnut Creek',
        rows: [],
        reviewedIds: {},
        switchEnabled: false,
        filter: 'flagged'
      };

      function post(msg) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(msg, '*');
        }
      }

      window.addEventListener('error', function (ev) {
        post({ type: 'script_error', message: ev && ev.message ? ev.message : 'Script error' });
      });

      function isFlagged(r) {
        return (
          r &&
          r.method === 'cash' &&
          typeof r.time === 'string' &&
          r.time >= '20:00' &&
          !r.linkedOrder &&
          Number(r.till) === 2 &&
          Number(r.operatorNumber) === 14
        );
      }

      function computeSummary() {
        var count = 0;
        var totalCents = 0;
        var unreviewed = 0;
        for (var i = 0; i < state.rows.length; i++) {
          var r = state.rows[i];
          if (isFlagged(r)) {
            count++;
            totalCents += Math.round(Number(r.amount || 0) * 100);
            if (!state.reviewedIds[r.id]) {
              unreviewed++;
            }
          }
        }
        return {
          count: count,
          total: Math.round(totalCents) / 100,
          unreviewedFlaggedCount: unreviewed
        };
      }

      function fmtUsd(val) {
        return '$' + Number(val || 0).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      }

      function render() {
        var summary = computeSummary();
        document.getElementById('store-title').textContent = state.storeName + ' — Refund exceptions desk';
        document.getElementById('flagged-count').textContent = String(summary.count);
        document.getElementById('flagged-total').textContent = fmtUsd(summary.total);
        document.getElementById('unreviewed-count').textContent = String(summary.unreviewedFlaggedCount);

        var swBtn = document.getElementById('approval-switch');
        swBtn.setAttribute('aria-checked', state.switchEnabled ? 'true' : 'false');
        document.getElementById('switch-note').textContent = state.switchEnabled
          ? 'Active: manager approval required for cash refunds over $50 at Walnut Creek.'
          : 'Currently off. Turning on requires owner confirmation through the gateway.';

        document.getElementById('tab-flagged').className = 'tab-btn' + (state.filter === 'flagged' ? ' active' : '');
        document.getElementById('tab-all').className = 'tab-btn' + (state.filter === 'all' ? ' active' : '');

        var list = [];
        for (var i = 0; i < state.rows.length; i++) {
          var row = state.rows[i];
          if (state.filter === 'flagged' && !isFlagged(row)) continue;
          list.push(row);
        }
        list.sort(function (a, b) {
          var fa = isFlagged(a) ? 1 : 0;
          var fb = isFlagged(b) ? 1 : 0;
          if (fa !== fb) return fb - fa;
          if (a.date !== b.date) return a.date > b.date ? -1 : 1;
          return a.time > b.time ? -1 : 1;
        });

        var container = document.getElementById('rows-container');
        container.innerHTML = '';
        if (list.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'sub';
          empty.textContent = 'No refund records match this view.';
          container.appendChild(empty);
          return;
        }

        for (var j = 0; j < list.length; j++) {
          (function (r) {
            var flagged = isFlagged(r);
            var reviewed = !!state.reviewedIds[r.id];
            var el = document.createElement('div');
            el.className = 'row-item' + (reviewed ? ' reviewed' : flagged ? ' flagged' : '');

            var left = document.createElement('div');
            var top = document.createElement('div');
            var amt = document.createElement('span');
            amt.className = 'row-amt';
            amt.textContent = fmtUsd(r.amount);
            top.appendChild(amt);

            if (flagged) {
              var tag = document.createElement('span');
              tag.className = 'tag ' + (reviewed ? 'tag-ok' : 'tag-flag');
              tag.textContent = reviewed ? 'Reviewed' : 'Unlinked cash >=20:00';
              top.appendChild(tag);
            }

            var meta = document.createElement('div');
            meta.className = 'row-meta';
            meta.textContent =
              r.date + ' ' + r.time + ' · Till ' + r.till + ' · Op ' + r.operatorNumber + ' · ' +
              r.method + (r.linkedOrder ? ' · linked order' : ' · no linked order');

            left.appendChild(top);
            left.appendChild(meta);

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rev-btn' + (reviewed ? ' done' : '');
            btn.textContent = reviewed ? 'Reviewed' : 'Mark reviewed';
            btn.addEventListener('click', function () {
              state.reviewedIds[r.id] = !state.reviewedIds[r.id];
              render();
              var nextSummary = computeSummary();
              post({
                type: 'mark_reviewed',
                refundId: r.id,
                reviewed: !!state.reviewedIds[r.id],
                unreviewedFlaggedCount: nextSummary.unreviewedFlaggedCount
              });
            });

            el.appendChild(left);
            el.appendChild(btn);
            container.appendChild(el);
          })(list[j]);
        }
      }

      document.getElementById('tab-flagged').addEventListener('click', function () {
        state.filter = 'flagged';
        render();
      });
      document.getElementById('tab-all').addEventListener('click', function () {
        state.filter = 'all';
        render();
      });
      document.getElementById('approval-switch').addEventListener('click', function () {
        var next = !state.switchEnabled;
        post({ type: 'switch_toggle', enabled: next });
      });

      window.addEventListener('message', function (ev) {
        var data = ev && ev.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'init') {
          state.storeName = data.storeName || 'Walnut Creek';
          state.rows = Array.isArray(data.rows) ? data.rows : [];
          state.switchEnabled = !!data.switchEnabled;
          state.reviewedIds = {};
          if (Array.isArray(data.reviewedIds)) {
            for (var i = 0; i < data.reviewedIds.length; i++) {
              state.reviewedIds[data.reviewedIds[i]] = true;
            }
          }
          render();
          var summary = computeSummary();
          post({
            type: 'flagged_summary',
            count: summary.count,
            total: summary.total,
            unreviewedFlaggedCount: summary.unreviewedFlaggedCount
          });
        } else if (data.type === 'test_mark_reviewed' && data.refundId) {
          state.reviewedIds[data.refundId] = true;
          render();
          var s = computeSummary();
          post({
            type: 'mark_reviewed',
            refundId: data.refundId,
            reviewed: true,
            unreviewedFlaggedCount: s.unreviewedFlaggedCount
          });
        }
      });

      post({ type: 'loaded' });
    })();
  </script>
</body>
</html>`;
