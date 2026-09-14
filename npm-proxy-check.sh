#!/usr/bin/env bash
# npm embargo-proxy diagnostic — run with:  bash npm-proxy-check.sh
# Read-only: no sudo, no config changes, no installs.

EXPECTED_PROXY="23.21.39.196"
say() { printf "\n\033[1m%s\033[0m\n" "$1"; }
ok()  { printf "  \033[32mOK\033[0m    %s\n" "$1"; }
bad() { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; }
inf() { printf "        %s\n" "$1"; }

say "1. /etc/hosts pin"
PIN=$(awk '!/^#/ && /registry\.npmjs\.org/ {print $1; exit}' /etc/hosts)
if [ -z "$PIN" ]; then
  bad "no registry.npmjs.org pin in /etc/hosts (step 1 of the IT instructions is missing)"
  PIN="$EXPECTED_PROXY"
else
  inf "pinned to: $PIN"
  if [ "$PIN" = "$EXPECTED_PROXY" ]; then
    ok "matches the documented proxy IP"
  else
    bad "differs from documented $EXPECTED_PROXY  <-- report this IP back"
  fi
fi

say "2. npm registry + cafile"
REG=$(npm config get registry 2>/dev/null)
CAFILE=$(npm config get cafile 2>/dev/null)
inf "registry = $REG"
inf "cafile   = $CAFILE"
case "$REG" in
  *registry.npmjs.org*) ok "npm targets public npm -> the proxy is in your install path" ;;
  *wixpress*)           bad "npm targets the INTERNAL registry -> you bypass the proxy entirely" ;;
  *)                    bad "unexpected registry" ;;
esac
if [ -f "$CAFILE" ]; then
  N=$(grep -c "BEGIN CERTIFICATE" "$CAFILE")
  ok "cafile exists, $N certs"
  [ "$N" -lt 5 ] && inf "only $N cert(s) — works for npmjs, but breaks npm.dev.wixpress.com"
  CURLCA=(--cacert "$CAFILE")
else
  bad "cafile not set or missing -> expect DEPTH_ZERO_SELF_SIGNED_CERT"
  CURLCA=(-k)
fi

say "3. Reachability"
if nc -z -G 6 "$PIN" 443 >/dev/null 2>&1; then
  ok "TCP $PIN:443 open (proxy reachable)"
else
  bad "TCP $PIN:443 unreachable (proxy down, or your egress is not allowed)"
fi
REAL=$(dig +short registry.npmjs.org @1.1.1.1 2>/dev/null | head -1)
if [ -n "$REAL" ]; then
  if nc -z -G 6 "$REAL" 443 >/dev/null 2>&1; then
    inf "real npm $REAL:443 also open (not blocked on your network)"
  else
    inf "real npm $REAL:443 blocked (expected — the proxy is mandatory)"
  fi
fi

say "4. Which host does npm actually talk to?"
IP=$(curl -s -m 20 "${CURLCA[@]}" -o /dev/null -w "%{remote_ip}" https://registry.npmjs.org/is-odd 2>/dev/null)
if [ -z "$IP" ]; then
  bad "no connection to registry.npmjs.org at all"
else
  inf "connected to: $IP"
  [ "$IP" = "$PIN" ] && ok "going through the proxy" || bad "NOT the proxy IP"
fi

say "5. Certificate presented"
SUBJ=$(echo | openssl s_client -connect "$PIN:443" -servername registry.npmjs.org 2>/dev/null \
       | awk '/^ 0 s:/{print; exit}')
if [ -z "$SUBJ" ]; then
  bad "no TLS handshake"
else
  inf "$SUBJ"
  if echo "$SUBJ" | grep -q "NPM Policy Proxy"; then
    ok "MITM proxy cert — you are behind the embargo gateway"
  else
    bad "not the proxy cert — you may be hitting real npm directly"
  fi
fi

say "6. Proxy marker headers"
H=$(curl -s -m 25 -D - -o /dev/null "${CURLCA[@]}" https://registry.npmjs.org/is-odd 2>/dev/null \
    | grep -iE "^(X-NPM-Policy|X-Embargo)" | tr -d '\r')
if [ -n "$H" ]; then
  ok "proxy headers present"
  echo "$H" | sed 's/^/        /'
else
  bad "no X-NPM-Policy-* / X-Embargo-* headers -> not the proxy"
fi

say "7. Is the 14-day age gate biting?"
NEWEST=$(curl -s -m 40 "${CURLCA[@]}" -H "Accept: application/vnd.npm.install-v1+json" \
         https://registry.npmjs.org/renovate 2>/dev/null \
         | python3 -c 'import json,sys; print(list(json.load(sys.stdin)["versions"])[-1])' 2>/dev/null)
FULL=$(curl -s -m 90 "${CURLCA[@]}" -H "Accept: application/json" \
       https://registry.npmjs.org/renovate 2>/dev/null \
       | python3 -c 'import json,sys; print(json.load(sys.stdin)["dist-tags"]["latest"])' 2>/dev/null)
inf "renovate newest upstream (abbreviated doc): ${NEWEST:-?}"
inf "renovate latest served   (full packument): ${FULL:-?}"
if [ -n "$NEWEST" ] && [ -n "$FULL" ]; then
  if [ "$NEWEST" != "$FULL" ]; then
    ok "packument is filtered -> age gate active"
  else
    bad "both views agree -> NO filtering (unfiltered public npm)"
  fi
fi
if [ -n "$NEWEST" ]; then
  CODE=$(curl -s -m 30 "${CURLCA[@]}" -o /dev/null -w "%{http_code}" \
         "https://registry.npmjs.org/renovate/$NEWEST" 2>/dev/null)
  inf "GET renovate/$NEWEST -> HTTP $CODE"
  [ "$CODE" = "403" ] && ok "fresh version blocked as expected" \
                      || bad "fresh version NOT blocked (expected 403)"
fi

say "8. Are our own packages waivered?"
for p in base44 "@base44%2Fsdk" "@base44-preview%2Fsdk"; do
  F=$(curl -s -m 45 -D - -o /dev/null "${CURLCA[@]}" -H "Accept: application/json" \
      "https://registry.npmjs.org/$p" 2>/dev/null | grep -ci "X-NPM-Policy-Filtered")
  [ "$F" = "0" ] && printf "  %-24s waivered (unfiltered)\n" "$p" \
                 || printf "  %-24s FILTERED\n" "$p"
done

say "9. End-to-end npm test (cache bypassed)"
if npm view is-odd version --prefer-online >/dev/null 2>&1; then
  ok "npm can fetch through the proxy"
else
  bad "npm fetch failed — rerun as: npm --verbose view is-odd --prefer-online"
fi

say "10. Network context (for comparing machines)"
inf "route to $PIN goes via: $(route -n get "$PIN" 2>/dev/null | awk '/interface:/{print $2}')"
inf "public egress IP:       $(curl -s -m 12 https://ifconfig.me/ip 2>/dev/null)"
inf "node $(node -v 2>/dev/null) / npm $(npm -v 2>/dev/null)"
printf "\n"
