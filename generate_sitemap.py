import datetime
from xml.etree import ElementTree as ET
from xml.dom import minidom
import os

BASE_URL = "https://www.readymadequiz.co.in"
TODAY = datetime.date.today().isoformat()

# Read all URLs from urls.txt
with open("urls.txt", "r") as f:
    urls = [line.strip() for line in f if line.strip()]

# Build the XML
urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")

for url in urls:
    url_elem = ET.SubElement(urlset, "url")
    
    loc = ET.SubElement(url_elem, "loc")
    loc.text = url
    
    lastmod = ET.SubElement(url_elem, "lastmod")
    lastmod.text = TODAY
    
    changefreq = ET.SubElement(url_elem, "changefreq")
    changefreq.text = "weekly"
    
    priority = ET.SubElement(url_elem, "priority")
    # Homepage gets 1.0, exam category pages get 0.9, mock tests get 0.8
    if url == BASE_URL + "/":
        priority.text = "1.0"
    elif "mock-test" in url:
        priority.text = "0.8"
    else:
        priority.text = "0.9"

# Pretty print and save
xml_str = ET.tostring(urlset, encoding="unicode")
parsed = minidom.parseString(xml_str)
pretty_xml = parsed.toprettyxml(indent="  ")

# Remove the XML declaration if you want to keep it clean
# (but keep it for Google)
with open("sitemap.xml", "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    # Skip the first line of minidom output because it adds its own declaration
    f.write("\n".join(pretty_xml.split("\n")[1:]))

print(f"✅ sitemap.xml generated successfully with {len(urls)} URLs!")
