# -*- coding: utf-8 -*-
"""
TotonouMovie プロジェクトの data/*.ts を読み書きする

- data/*.ts は「型定義などのヘッダ」＋「export const xxx = [ ... ];」＋「フッタ」でできている
- 配列の中身（1行1件の JS オブジェクト）だけを読み書きし、ヘッダ・フッタは1文字も変えない
  （エンジン側 tm_datafile.py と同じ考え方）
- 行末のコメント（例: `// photo:p01`）は項目ごとに `_comment` として保持し、書き戻す
- 読めない項目（式が入っているなど）は `_raw` に原文を入れて、そのまま書き戻す
"""
import json
import os
import re

# 編集画面で扱うデータファイル（ファイル名 → 配列の名前）
DATA_FILES = {
    "telop": ("telopData.ts", "telopData"),
    "cut": ("cutData.ts", "cutData"),
    "se": ("seData.ts", "seData"),
    "zoom": ("zoomData.ts", "zoomData"),
    "motion": ("motionGraphicsData.ts", "motionGraphicsData"),
    "image": ("insertImageData.ts", "insertImageData"),
    "section": ("sectionData.ts", "sectionData"),
    "chapterCard": ("chapterCardData.ts", "chapterCardData"),
    "bgm": ("bgmData.ts", "bgmData"),
    "highlight": ("highlightData.ts", "highlightData"),
    "annotation": ("annotationData.ts", "annotationData"),
    "shot": ("shotData.ts", "shotData"),
}


class ParseError(Exception):
    pass


# ======================================================================
# 文字列・コメントを飛ばしながら配列の範囲を探す
# ======================================================================
def _skip_non_code(text, i):
    """text[i] が文字列かコメントの先頭なら、その終わりの次の位置を返す。違えば i"""
    ch = text[i]
    n = len(text)
    if ch in "\"'`":
        j = i + 1
        while j < n:
            c = text[j]
            if c == "\\":
                j += 2
                continue
            if c == ch:
                return j + 1
            j += 1
        return n
    if ch == "/" and i + 1 < n:
        if text[i + 1] == "/":
            j = text.find("\n", i)
            return n if j < 0 else j
        if text[i + 1] == "*":
            j = text.find("*/", i + 2)
            return n if j < 0 else j + 2
    return i


def find_array_span(text, name):
    """`export const <name>... = [` の `[` と対応する `]` の位置を返す。無ければ None"""
    m = re.compile(rf"^export\s+const\s+{re.escape(name)}\b[^=]*=\s*\[", re.MULTILINE).search(text)
    if not m:
        return None
    open_idx = m.end() - 1
    depth = 0
    i = open_idx
    while i < len(text):
        j = _skip_non_code(text, i)
        if j != i:
            i = j
            continue
        c = text[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return open_idx, i
        i += 1
    return None


# ======================================================================
# JS のオブジェクトリテラルを Python の値に変換する小さなパーサー
# ======================================================================
class _Parser:
    def __init__(self, s):
        self.s = s
        self.i = 0

    def ws(self):
        """空白とコメントを読み飛ばす"""
        s = self.s
        while self.i < len(s):
            c = s[self.i]
            if c in " \t\r\n":
                self.i += 1
            elif s.startswith("//", self.i):
                j = s.find("\n", self.i)
                self.i = len(s) if j < 0 else j
            elif s.startswith("/*", self.i):
                j = s.find("*/", self.i + 2)
                self.i = len(s) if j < 0 else j + 2
            else:
                break

    def peek(self):
        self.ws()
        return self.s[self.i] if self.i < len(self.s) else ""

    def value(self):
        c = self.peek()
        if c == "{":
            return self.obj()
        if c == "[":
            return self.arr()
        if c in "\"'`":
            return self.string()
        m = re.compile(r"-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?").match(self.s, self.i)
        if m:
            self.i = m.end()
            t = m.group(0)
            return float(t) if any(ch in t for ch in ".eE") else int(t)
        m = re.compile(r"[A-Za-z_$][\w$]*").match(self.s, self.i)
        if m:
            w = m.group(0)
            if w in ("true", "false", "null", "undefined"):
                self.i = m.end()
                return {"true": True, "false": False, "null": None, "undefined": None}[w]
        raise ParseError(f"読めない値: {self.s[self.i:self.i + 30]!r}")

    def string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while self.i < len(self.s):
            c = self.s[self.i]
            if c == "\\":
                nx = self.s[self.i + 1]
                if nx == "u":
                    out.append(chr(int(self.s[self.i + 2:self.i + 6], 16)))
                    self.i += 6
                    continue
                out.append({"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "0": "\0"}.get(nx, nx))
                self.i += 2
                continue
            if c == q:
                self.i += 1
                return "".join(out)
            if q == "`" and c == "$" and self.s.startswith("${", self.i):
                raise ParseError("テンプレート文字列の式は読めません")
            out.append(c)
            self.i += 1
        raise ParseError("文字列が閉じていません")

    def key(self):
        c = self.peek()
        if c in "\"'":
            return self.string()
        m = re.compile(r"[A-Za-z_$][\w$]*|\d+").match(self.s, self.i)
        if not m:
            raise ParseError(f"読めないキー: {self.s[self.i:self.i + 30]!r}")
        self.i = m.end()
        return m.group(0)

    def obj(self):
        self.i += 1
        d = {}
        while True:
            if self.peek() == "}":
                self.i += 1
                return d
            k = self.key()
            if self.peek() != ":":
                raise ParseError("':' がありません")
            self.i += 1
            d[k] = self.value()
            c = self.peek()
            if c == ",":
                self.i += 1
            elif c != "}":
                raise ParseError(f"',' か '}}' が必要です: {self.s[self.i:self.i + 30]!r}")

    def arr(self):
        self.i += 1
        a = []
        while True:
            if self.peek() == "]":
                self.i += 1
                return a
            a.append(self.value())
            c = self.peek()
            if c == ",":
                self.i += 1
            elif c != "]":
                raise ParseError("',' か ']' が必要です")


def parse_js_value(s):
    p = _Parser(s)
    v = p.value()
    p.ws()
    return v


# ======================================================================
# 配列の中身 ⇔ 項目のリスト
# ======================================================================
def split_items(body):
    """配列の中身を、最上位の項目（原文・行末コメント）に分ける"""
    items = []
    i, n = 0, len(body)
    while i < n:
        c = body[i]
        if c in " \t\r\n,":
            i += 1
            continue
        if body.startswith("//", i) or body.startswith("/*", i):
            # 項目の前にある単独のコメントは捨てずに「コメントだけの項目」として残す
            j = _skip_non_code(body, i)
            items.append({"_raw": body[i:j], "_onlyComment": True})
            i = j
            continue
        # 1項目の終わり（最上位の , か終端）を探す
        start = i
        depth = 0
        while i < n:
            j = _skip_non_code(body, i)
            if j != i:
                i = j
                continue
            ch = body[i]
            if ch in "{[(":
                depth += 1
            elif ch in "}])":
                depth -= 1
            elif ch == "," and depth == 0:
                break
            i += 1
        raw = body[start:i].strip()
        # 区切りの , の後ろ、同じ行にある // コメントはこの項目のもの
        comment = None
        if i < n and body[i] == ",":
            i += 1
        m = re.compile(r"[ \t]*//([^\n]*)").match(body, i)
        if m:
            comment = m.group(1).strip()
            i = m.end()
        # 項目の原文の末尾に付いた // コメント（カンマ無しの最後の項目）
        m2 = re.search(r"\s*//([^\n]*)$", raw)
        if m2 and comment is None:
            try:
                parse_js_value(raw[:m2.start()])
                comment = m2.group(1).strip()
                raw = raw[:m2.start()].rstrip()
            except ParseError:
                pass
        try:
            v = parse_js_value(raw)
            if isinstance(v, dict):
                v = dict(v)
                if comment:
                    v["_comment"] = comment
                items.append(v)
            else:
                items.append({"_raw": raw, "_comment": comment})
        except ParseError:
            items.append({"_raw": raw, "_comment": comment})
    return items


_IDENT = re.compile(r"^[A-Za-z_$][\w$]*$")


def js_value(v):
    """Python の値を TS のリテラル文字列にする（キーは引用符なし）"""
    if isinstance(v, dict):
        parts = []
        for k, x in v.items():
            if k.startswith("_") or x is None:
                continue
            kk = k if _IDENT.match(k) else json.dumps(k, ensure_ascii=False)
            parts.append(f"{kk}: {js_value(x)}")
        return "{ " + ", ".join(parts) + " }" if parts else "{}"
    if isinstance(v, list):
        return "[" + ", ".join(js_value(x) for x in v) + "]"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        r = round(v, 3)
        return str(int(r)) if r == int(r) else repr(r)
    if v is None:
        return "null"
    return json.dumps(v, ensure_ascii=False)


def build_body(items):
    lines = []
    for it in items:
        if it.get("_onlyComment"):
            lines.append("  " + it["_raw"])
            continue
        src = it["_raw"] if "_raw" in it else js_value(it)
        line = "  " + src + ","
        if it.get("_comment"):
            line += " // " + it["_comment"]
        lines.append(line)
    return ("\n" + "\n".join(lines) + "\n") if lines else ""


# ======================================================================
# ファイル単位の読み書き
# ======================================================================
def data_path(project, key):
    return os.path.join(project, "data", DATA_FILES[key][0])


def read_items(project, key):
    """データファイルの項目リストを返す。ファイルや配列が無ければ []"""
    p = data_path(project, key)
    if not os.path.exists(p):
        return []
    text = open(p, encoding="utf-8").read()
    span = find_array_span(text, DATA_FILES[key][1])
    if not span:
        return []
    return split_items(text[span[0] + 1:span[1]])


def write_items(project, key, items, template_dir=None):
    """配列の中身だけを書き換える。ファイルが無ければテンプレートのファイルを元にする"""
    p = data_path(project, key)
    fname, name = DATA_FILES[key]
    if os.path.exists(p):
        text = open(p, encoding="utf-8").read()
    elif template_dir and os.path.exists(os.path.join(template_dir, "data", fname)):
        text = open(os.path.join(template_dir, "data", fname), encoding="utf-8").read()
    else:
        text = f"export const {name}: any[] = [];\n"
    span = find_array_span(text, name)
    if not span:
        raise ParseError(f"{fname} に {name} の配列が見つかりません")
    new = text[:span[0] + 1] + build_body(items) + text[span[1]:]
    if new != text:
        # 書き換え前の内容は .bak に1世代だけ残す
        if os.path.exists(p):
            with open(p + ".bak", "w", encoding="utf-8") as f:
                f.write(text)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(new)
        os.replace(tmp, p)
    return new != text


def read_config_object(project, fname, name):
    """`export const bgmConfig = { ... };` のような設定オブジェクトを読む。無ければ None"""
    p = os.path.join(project, "data", fname)
    if not os.path.exists(p):
        return None
    text = open(p, encoding="utf-8").read()
    m = re.compile(rf"^export\s+const\s+{re.escape(name)}\b[^=]*=\s*\{{", re.MULTILINE).search(text)
    if not m:
        return None
    start = m.end() - 1
    depth, i = 0, start
    while i < len(text):
        j = _skip_non_code(text, i)
        if j != i:
            i = j
            continue
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    src = re.sub(r"\bas\s+[\w|\s\"']+?(?=[,}\n])", "", text[start:i + 1])
    try:
        return parse_js_value(src)
    except ParseError:
        return None


def set_config_value(project, fname, name, key, value):
    """設定オブジェクトの1つのキー（数値・真偽値）を書き換える（例: bgmConfig.enabled）"""
    p = os.path.join(project, "data", fname)
    text = open(p, encoding="utf-8").read()
    m = re.compile(rf"^export\s+const\s+{re.escape(name)}\b[^=]*=\s*\{{", re.MULTILINE).search(text)
    if not m:
        raise ParseError(f"{name} が見つかりません")
    seg_re = re.compile(rf"(\b{re.escape(key)}\s*:\s*)([^,\n}}]+)")
    mm = seg_re.search(text, m.end())
    if not mm:
        raise ParseError(f"{name}.{key} が見つかりません")
    new = text[:mm.start(2)] + js_value(value) + text[mm.end(2):]
    with open(p, "w", encoding="utf-8") as f:
        f.write(new)
