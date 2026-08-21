import datetime
from xml.etree import ElementTree as ET
from xml.dom import minidom

BASE_URL = "https://www.readymadequiz.co.in"
TODAY = datetime.date.today().isoformat()

# Read all paths from urls.txt
with open("urls.txt", "r") as f:
    paths = [line.strip() for line in f if line.strip()]

# Build the XML
urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")

for path in paths:
    url = ET.SubElement(urlset, "url")
    loc = ET.SubElement(url, "loc")
    loc.text = BASE_URL + path
    lastmod = ET.SubElement(url, "lastmod")
    lastmod.text = TODAY
    changefreq = ET.SubElement(url, "changefreq")
    changefreq.text = "weekly"
    priority = ET.SubElement(url, "priority")
    # Set priority based on path depth (home = 1.0, deeper = lower)
    if path == "/":
        priority.text = "1.0"
    else:
        priority.text = "0.8"  # Adjust as needed

# Pretty print and save
xml_str = ET.tostring(urlset, encoding="unicode")
parsed = minidom.parseString(xml_str)
pretty_xml = parsed.toprettyxml(indent="  ")

with open("sitemap.xml", "w", encoding="utf-8") as f:
    f.write(pretty_xml)

print("✅ sitemap.xml generated successfully!")
