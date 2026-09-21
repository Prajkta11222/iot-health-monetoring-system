"""
Local training script for ECG Risk Classification Model.
Trains a RandomForest model on MIT-BIH data and saves it for ml-service.

Usage:
    python train_model.py
"""

import os
import sys
import json
import time
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, roc_auc_score, average_precision_score
import joblib

# ============================
# CONFIGURATION
# ============================
TRAIN_PATH = os.path.join(os.path.dirname(__file__), "mitbih_train.csv")
TEST_PATH = os.path.join(os.path.dirname(__file__), "mitbih_test.csv")
MODEL_OUTPUT = os.path.join(os.path.dirname(__file__), "ecg_risk_model.pkl")
METADATA_OUTPUT = os.path.join(os.path.dirname(__file__), "metadata.json")
RANDOM_STATE = 42

# Risk mapping:
# 0 = Normal             -> LOW  (0)
# 1 = Supraventricular   -> HIGH (1)
# 2 = Ventricular        -> HIGH (1)
# 3 = Fusion             -> HIGH (1)
# 4 = Unknown            -> EXCLUDED
RISK_MAP = {0: 0, 1: 1, 2: 1, 3: 1}


def main():
    print("=" * 60)
    print("ECG Risk Classification Model - Local Training")
    print("=" * 60)

    # --- Stage 1: Load Data ---
    print("\n[1/4] Loading data...")
    if not os.path.exists(TRAIN_PATH):
        sys.exit(f"ERROR: Train file not found: {TRAIN_PATH}")
    if not os.path.exists(TEST_PATH):
        sys.exit(f"ERROR: Test file not found: {TEST_PATH}")

    train = pd.read_csv(TRAIN_PATH, header=None)
    test = pd.read_csv(TEST_PATH, header=None)

    print(f"  Train shape: {train.shape}")
    print(f"  Test shape : {test.shape}")

    LABEL = train.columns[-1]
    ECG_COLS = train.columns[:-1]

    print(f"\n  Original class distribution (train):")
    for cls, count in train[LABEL].value_counts().sort_index().items():
        print(f"    Class {int(cls)}: {count:>6d}")

    # --- Stage 2: Prepare Data ---
    print("\n[2/4] Preparing data...")

    # Exclude class 4 (Unknown)
    train = train[train[LABEL] != 4].copy()
    test = test[test[LABEL] != 4].copy()

    X = train[ECG_COLS].astype(np.float32)
    y = train[LABEL].map(RISK_MAP).astype(np.int8)

    X_test = test[ECG_COLS].astype(np.float32)
    y_test = test[LABEL].map(RISK_MAP).astype(np.int8)

    print(f"  Training data: {X.shape}")
    print(f"  Test data    : {X_test.shape}")
    print(f"\n  Binary distribution (train):")
    for label, name in [(0, "LOW"), (1, "HIGH")]:
        print(f"    {name}: {(y == label).sum():>6d}")

    # --- Stage 3: Train Model ---
    print("\n[3/4] Training RandomForest model...")

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.15, stratify=y, random_state=RANDOM_STATE
    )
    print(f"  Training samples  : {len(X_train)}")
    print(f"  Validation samples: {len(X_val)}")

    model = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("classifier", RandomForestClassifier(
            n_estimators=100,
            max_depth=20,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            n_jobs=-1,
        )),
    ])

    start = time.time()
    model.fit(X_train, y_train)
    elapsed = time.time() - start
    print(f"  Training complete in {elapsed:.1f}s")

    # Validation results
    val_prob = model.predict_proba(X_val)[:, 1]
    val_pred = (val_prob >= 0.5).astype(np.int8)

    print("\n  --- VALIDATION RESULTS ---")
    print(classification_report(y_val, val_pred, target_names=["LOW", "HIGH"], digits=4))
    print(f"  ROC-AUC: {roc_auc_score(y_val, val_prob):.4f}")
    print(f"  PR-AUC : {average_precision_score(y_val, val_prob):.4f}")

    # --- Stage 4: Final Test + Save ---
    print("\n[4/4] Final test evaluation & saving model...")

    test_prob = model.predict_proba(X_test)[:, 1]
    test_pred = (test_prob >= 0.5).astype(np.int8)

    print("\n  --- FINAL TEST RESULTS ---")
    print(classification_report(y_test, test_pred, target_names=["LOW", "HIGH"], digits=4))
    print(f"  ROC-AUC: {roc_auc_score(y_test, test_prob):.4f}")
    print(f"  PR-AUC : {average_precision_score(y_test, test_prob):.4f}")

    # Save model
    joblib.dump(model, MODEL_OUTPUT)
    print(f"\n  Model saved to: {MODEL_OUTPUT}")

    # Save metadata
    metadata = {
        "model": "RandomForestClassifier",
        "version": "1.0",
        "input_samples": 187,
        "sampling_rate_hz": 125,
        "target": "risk_level",
        "labels": {"0": "LOW", "1": "HIGH"},
        "original_mapping": {
            "0": "LOW",
            "1": "HIGH",
            "2": "HIGH",
            "3": "HIGH",
            "4": "EXCLUDED",
        },
        "random_state": RANDOM_STATE,
        "note": "ECG abnormality/research-risk classification, not medical diagnosis.",
    }
    with open(METADATA_OUTPUT, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"  Metadata saved to: {METADATA_OUTPUT}")

    # Quick sanity check
    print("\n  --- SANITY CHECK ---")
    sample = X_test.iloc[0:1].values
    pred = model.predict(sample)
    prob = model.predict_proba(sample)
    label = "LOW" if int(pred[0]) == 0 else "HIGH"
    class_idx = list(model.classes_).index(1)
    risk_prob = float(prob[0][class_idx])
    print(f"  Sample prediction: {label} (HIGH probability: {risk_prob:.4f})")
    print(f"  Model classes: {model.classes_}")

    print("\n" + "=" * 60)
    print("Training complete! Model is ready for ml-service.")
    print("=" * 60)


if __name__ == "__main__":
    main()
