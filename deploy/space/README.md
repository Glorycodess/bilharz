---
title: Bilharz
emoji: 🔬
colorFrom: blue
colorTo: gray
sdk: gradio
sdk_version: 6.30.0
python_version: "3.12.12"
app_file: app.py
pinned: false
license: mit
short_description: Triage for urogenital schistosomiasis from urine microscopy
---

# Bilharz

Patient-level triage for urogenital schistosomiasis from urine microscopy. A
sample's 117 microscope images are cut into 1,404 tiles and scored by an egg
detector. Clear negatives and clear positives are decided automatically, and
only the uncertain samples are referred to a technician.

- The app: https://iamglory-bilharz.hf.space
- Source code, notebooks and evaluation: https://github.com/Glorycodess/bilharz

This Space is assembled from the GitHub repository by `deploy/build_space.sh`.
Research prototype, final-year capstone. Not a medical device.
