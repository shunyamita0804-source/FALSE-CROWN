from itertools import permutations, product
from collections import Counter
import random, statistics
# P08: comparison against every possible fixed opponent sequence. Pairwise exchange proof is general for deterministic sequences.
ref=(1,8,2,7,3,6,4,5)
swap=(8,1,7,2,6,3,5,4)
def p08(a,b):
 return sum(1 if x==y else 2 if ((x>y) if i%2==0 else (x<y)) else 0 for i,(x,y) in enumerate(zip(a,b)))
c=Counter((p08(swap,b)>p08(ref,b))-(p08(swap,b)<p08(ref,b)) for b in permutations(range(1,9)))
print('P08 example swapped vs all 40320 fixed opponent permutations: ', dict(c))
# S05 all 60 open loop three-card sequences; 5,4,3 weakly improves 1,2,3 against every opponent.
seq=list(permutations(range(1,6),3))
def s05(a,b):return sum((x>y)-(x<y) for x,y in zip(a,b))
print('S05 example (5,4,3) vs (1,2,3), outcomes against 60 fixed sequences:',dict(Counter((s05((5,4,3),b)>s05((1,2,3),b))-(s05((5,4,3),b)<s05((1,2,3),b)) for b in seq)))
# P03 random legal actions, not AI. Fixed seat vs rotating first player by full hand-round.
rng=random.Random(2711)
for rotate in (False,True):
 n=20000; sumscore=[0]*4; last=[0]*4; ties=0
 for _ in range(n):
  hands=[list(range(1,10)) for _ in range(4)]; pts=[0]*4; total=0
  for r in range(9):
   for j in range(4):
    i=(j+(r if rotate else 0))%4
    v=hands[i].pop(rng.randrange(len(hands[i])));total+=v
    if total>=21:
     pts[i]+=3 if total==21 else -3; total=0
  mn=min(pts); k=pts.count(mn); ties+=k>1
  for i,p in enumerate(pts):
   sumscore[i]+=p;last[i]+=(1/k if p==mn else 0)
 print('P03 random-only', 'rotate' if rotate else 'fixed', 'mean points', [round(v/n,3) for v in sumscore], 'fractional last share', [round(v/n,4) for v in last], 'last tie',round(ties/n,4))
# P01: illustrative expected declaration payoffs per respondent given same doubt rate
for p in [0,.25,1/3,.5,1]: print('P01 doubt',round(p,3),'original truth/lie',1,round(2-4*p,3),'proposal truth/lie',round(2*p,3),round(2-4*p,3))
