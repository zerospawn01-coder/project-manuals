#!/usr/bin/env python3
"""
Phase14 Rule Mining
Extracts association rules and scoring criteria from clustering output.
"""

import pandas as pd
import numpy as np
from pathlib import Path

def mine_rules(clustering_output_path):
    """
    Mine rules from clustering output.
    Simulates association rule extraction (apriori-like logic).
    """
    
    # Load clustering output
    df = pd.read_csv(clustering_output_path)
    
    rules = []
    
    # Rule 1: High-value customers in specific clusters
    for cluster_id in df['cluster_id'].unique():
        cluster_df = df[df['cluster_id'] == cluster_id]
        avg_score = cluster_df['customer_score'].mean()
        support = len(cluster_df) / len(df)
        
        if support > 0.05:  # minimum support
            rule = {
                'rule_id': f'RULE_CLUSTER_{cluster_id}',
                'condition': f'cluster_id={cluster_id}',
                'support': support,
                'confidence': min(avg_score / 100, 1.0),
                'lift': (avg_score / 100) / (df['customer_score'].mean() / 100),
                'score_multiplier': 1.0 + (avg_score - df['customer_score'].mean()) / 100,
            }
            rules.append(rule)
    
    # Rule 2: Category-based rules
    for category in df['product_category'].unique():
        category_df = df[df['product_category'] == category]
        avg_score = category_df['customer_score'].mean()
        support = len(category_df) / len(df)
        
        if support > 0.1:
            rule = {
                'rule_id': f'RULE_CAT_{category}',
                'condition': f'product_category={category}',
                'support': support,
                'confidence': min(avg_score / 100, 1.0),
                'lift': (avg_score / 100) / (df['customer_score'].mean() / 100),
                'score_multiplier': 1.0 + (avg_score - df['customer_score'].mean()) / 100,
            }
            rules.append(rule)
    
    # Rule 3: Region-based rules
    for region in df['region'].unique():
        region_df = df[df['region'] == region]
        avg_score = region_df['customer_score'].mean()
        support = len(region_df) / len(df)
        
        if support > 0.1:
            rule = {
                'rule_id': f'RULE_REG_{region}',
                'condition': f'region={region}',
                'support': support,
                'confidence': min(avg_score / 100, 1.0),
                'lift': (avg_score / 100) / (df['customer_score'].mean() / 100),
                'score_multiplier': 1.0 + (avg_score - df['customer_score'].mean()) / 100,
            }
            rules.append(rule)
    
    return rules

def extract_rule_features(clustering_output_path):
    """Extract aggregated rule statistics for candidate generation."""
    
    rules = mine_rules(clustering_output_path)
    df_rules = pd.DataFrame(rules)
    
    return {
        'total_rules': len(rules),
        'avg_confidence': df_rules['confidence'].mean(),
        'avg_lift': df_rules['lift'].mean(),
        'high_confidence_rules': len(df_rules[df_rules['confidence'] > 0.7]),
    }

if __name__ == "__main__":
    clustering_file = Path(__file__).parent.parent / "data" / "clustering_output.csv"
    
    if not clustering_file.exists():
        print(f"Error: {clustering_file} not found")
        exit(1)
    
    rules = mine_rules(str(clustering_file))
    print(f"✓ Mined {len(rules)} rules")
    print(f"\nTop rules by confidence:")
    df_rules = pd.DataFrame(rules)
    print(df_rules.nlargest(5, 'confidence')[['rule_id', 'support', 'confidence', 'lift']])
