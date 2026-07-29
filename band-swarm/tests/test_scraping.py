from band_swarm import scraping

FIXTURE = """<!doctype html>
<html>
<head><title>Magic Spoon — Healthy Cereal</title><meta name="x" content="junk"></head>
<body>
<nav><a href="/hidden-nav">nav link</a></nav>
<script>var tracking = "noise";</script>
<!-- a comment -->
<h1>Cereal that&#39;s too good to be true</h1>
<p>13g protein &amp; 0g sugar per bowl.</p>
<div>Tastes   like   childhood.</div>
<a href="/pages/about">About us</a>
<a href="/pages/about/">About duplicate</a>
<a href="https://other.example.com/away">external</a>
<a href="/products/cocoa">Cocoa</a>
<a href="/products/fruity">Fruity</a>
<a href="/products/peanut-butter">PB</a>
<a href="/logo.png">logo</a>
<a href="/reviews">Reviews</a>
<footer><a href="/hidden-footer">footer link</a></footer>
</body>
</html>"""

BASE = "https://magicspoon.com/"


def test_html_to_text_strips_and_decodes():
    text = scraping.html_to_text(FIXTURE)
    assert "Magic Spoon — Healthy Cereal" not in text  # head stripped
    assert "tracking" not in text  # script stripped
    assert "nav link" not in text and "footer link" not in text
    assert "a comment" not in text
    assert "Cereal that's too good to be true" in text
    assert "13g protein & 0g sugar per bowl." in text
    assert "Tastes like childhood." in text  # whitespace collapsed


def test_extract_title():
    assert scraping.extract_title(FIXTURE) == "Magic Spoon — Healthy Cereal"


def test_extract_internal_links_same_origin_dedup_assets():
    links = scraping.extract_internal_links(FIXTURE, BASE)
    assert "https://magicspoon.com/pages/about" in links
    assert not any("other.example.com" in u for u in links)
    assert not any(u.endswith(".png") for u in links)
    # trailing-slash duplicate collapsed
    assert sum("pages/about" in u for u in links) == 1


def test_rank_and_diversify():
    links = scraping.rank_links(scraping.extract_internal_links(FIXTURE, BASE))
    assert "about" in links[0]  # PRIORITY keyword wins
    assert "/products/" in links[-1]  # LOW_PRIORITY sinks
    diversified = scraping.diversify(links)
    assert sum("/products/" in u for u in diversified) == 2  # bucket capped


def test_plan_crawl_excludes_base():
    plan = scraping.plan_crawl(FIXTURE, BASE)
    assert BASE not in plan and "https://magicspoon.com" not in plan
    assert len(plan) <= 12


def test_normalize_matches_analyst_semantics():
    assert scraping.normalize("  13g   Protein\n& 0g Sugar ") == "13g protein & 0g sugar"
