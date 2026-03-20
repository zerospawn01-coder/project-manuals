#!/usr/bin/env python3
"""Verify priority_score ordering"""

import pandas as pd

df = pd.read_csv('phase14/data/candidate_snapshot.csv')

print("Priority Score Verification")
print("=" * 50)
print(f"Total candidates: {len(df)}")
print(f"Priority score range: {df['priority_score'].min():.3f} - {df['priority_score'].max():.3f}")
print(f"Mean priority score: {df['priority_score'].mean():.3f}")
print()
print("Top 5 candidates:")
print(df.head(5)[['candidate_id', 'priority_score', 'cluster_id']].to_string(index=False))
print()

# Check if descending order
is_descending = (df['priority_score'].iloc[:-1].values >= df['priority_score'].iloc[1:].values).all()
print(f"Is descending order: {is_descending}")

if is_descending:
    print("\n✓ PASS: priority_score is sorted in descending order")
else:
    print("\n✗ FAIL: priority_score is not properly sorted")
