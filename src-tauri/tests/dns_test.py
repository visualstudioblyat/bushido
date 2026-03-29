import asyncio, json, struct, socket, time, sys
import urllib.request

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 0
RESULTS = []
BASE = ""

def build_dns_query(domain, qtype=1):
    txid = b'\x00\x00'
    flags = b'\x01\x00'
    counts = struct.pack('>HHHH', 1, 0, 0, 0)
    qname = b''
    for label in domain.split('.'):
        qname += bytes([len(label)]) + label.encode()
    qname += b'\x00'
    qclass = struct.pack('>H', 1)
    qt = struct.pack('>H', qtype)
    return txid + flags + counts + qname + qt + qclass

def parse_dns_response(data):
    rcode = data[3] & 0x0f
    ancount = struct.unpack('>H', data[6:8])[0]
    return {'rcode': rcode, 'ancount': ancount, 'raw': data}

def doh_post(domain, qtype=1):
    q = build_dns_query(domain, qtype)
    req = urllib.request.Request(
        f'{BASE}/dns-query',
        data=q,
        headers={'Content-Type': 'application/dns-message', 'Accept': 'application/dns-message'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return parse_dns_response(r.read())
    except Exception as e:
        return {'error': str(e)}

def doh_get(domain, qtype=1):
    import base64
    q = build_dns_query(domain, qtype)
    encoded = base64.urlsafe_b64encode(q).rstrip(b'=').decode()
    req = urllib.request.Request(
        f'{BASE}/dns-query?dns={encoded}',
        headers={'Accept': 'application/dns-message'},
        method='GET'
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return parse_dns_response(r.read())
    except Exception as e:
        return {'error': str(e)}

def stats():
    try:
        with urllib.request.urlopen(f'{BASE}/stats', timeout=3) as r:
            return json.loads(r.read())
    except:
        return {}

def test(name, condition, detail=""):
    RESULTS.append((name, condition, detail))
    mark = "\033[32mPASS\033[0m" if condition else "\033[31mFAIL\033[0m"
    print(f"  {mark} {name}" + (f" ({detail})" if detail else ""))

def run():
    global PORT, BASE
    print("=" * 60)
    print("  BUSHIDO DoH RESOLVER TEST SUITE")
    print("=" * 60)

    if PORT == 0:
        print("  usage: python dns_test.py <port>")
        print("  start the resolver first, pass the port number")
        return

    BASE = f"http://127.0.0.1:{PORT}"

    # health check
    s = stats()
    test("resolver responding", "queries" in s, f"port {PORT}")

    # basic A query via POST
    r = doh_post("example.com")
    test("POST A query works", 'error' not in r and r['rcode'] == 0)
    test("POST returns answers", 'error' not in r and r['ancount'] > 0, f"ancount={r.get('ancount',0)}")

    # basic A query via GET
    r = doh_get("example.com")
    test("GET A query works", 'error' not in r and r['rcode'] == 0)

    # AAAA query
    r = doh_post("google.com", qtype=28)
    test("AAAA query works", 'error' not in r and r['rcode'] == 0)

    # cache test
    s1 = stats()
    doh_post("example.com")
    s2 = stats()
    cached = s2.get('hits', 0) > s1.get('hits', 0)
    test("cache hit on repeat query", cached, f"hits {s1.get('hits',0)} -> {s2.get('hits',0)}")

    # blocklist test - known cname tracker
    r = doh_post("data.adobedc.net")
    test("blocked tracker returns NXDOMAIN", 'error' not in r and r['rcode'] == 3)

    r = doh_post("sc.omtrdc.net")
    test("blocked tracker 2", 'error' not in r and r['rcode'] == 3)

    r = doh_post("demdex.net")
    test("blocked tracker 3", 'error' not in r and r['rcode'] == 3)

    # subdomain blocking
    r = doh_post("sub.data.adobedc.net")
    test("subdomain of tracker blocked", 'error' not in r and r['rcode'] == 3)

    # legit domain not blocked
    r = doh_post("google.com")
    test("legit domain NOT blocked", 'error' not in r and r['rcode'] == 0 and r['ancount'] > 0)

    r = doh_post("github.com")
    test("github.com NOT blocked", 'error' not in r and r['rcode'] == 0)

    # NXDOMAIN for nonexistent
    r = doh_post("thisdomaindoesnotexist12345.com")
    test("NXDOMAIN for nonexistent", 'error' not in r and r['rcode'] == 3)

    # malformed query
    try:
        req = urllib.request.Request(
            f'{BASE}/dns-query', data=b'\x00\x01\x02',
            headers={'Content-Type': 'application/dns-message'}, method='POST'
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            test("malformed query handled", resp.status == 500)
    except urllib.error.HTTPError as e:
        test("malformed query handled", e.code == 500)
    except:
        test("malformed query handled", False, "unexpected error")

    # empty GET param
    try:
        req = urllib.request.Request(f'{BASE}/dns-query', method='GET')
        with urllib.request.urlopen(req, timeout=3) as resp:
            test("empty GET param rejected", resp.status == 400)
    except urllib.error.HTTPError as e:
        test("empty GET param rejected", e.code == 400)
    except:
        test("empty GET param rejected", False)

    # latency test
    t0 = time.time()
    for _ in range(10):
        doh_post("cloudflare.com")
    elapsed = (time.time() - t0) * 1000
    avg = elapsed / 10
    test("avg latency < 100ms", avg < 100, f"{avg:.1f}ms avg over 10 queries")

    # cached latency
    doh_post("mozilla.org")
    t0 = time.time()
    for _ in range(100):
        doh_post("mozilla.org")
    elapsed = (time.time() - t0) * 1000
    avg = elapsed / 100
    test("cached latency < 5ms", avg < 5, f"{avg:.2f}ms avg over 100 cached")

    # stats check
    s = stats()
    test("queries counted", s.get('queries', 0) > 0, f"total={s.get('queries',0)}")
    test("cache hits counted", s.get('hits', 0) > 0, f"hits={s.get('hits',0)}")
    test("blocked counted", s.get('blocked', 0) > 0, f"blocked={s.get('blocked',0)}")
    test("upstream counted", s.get('upstream', 0) > 0, f"upstream={s.get('upstream',0)}")
    test("cache populated", s.get('cache', 0) > 0, f"entries={s.get('cache',0)}")

    # popular sites resolve
    for domain in ["linkedin.com", "twitter.com", "amazon.com", "reddit.com", "netflix.com"]:
        r = doh_post(domain)
        test(f"{domain} resolves", 'error' not in r and r['rcode'] == 0 and r['ancount'] > 0)

    # summary
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print()
    print("=" * 60)
    print(f"  {passed}/{len(RESULTS)} passed" + (f", {failed} FAILED" if failed else ""))
    print("=" * 60)
    print()
    print(json.dumps(stats(), indent=2))

if __name__ == '__main__':
    run()
