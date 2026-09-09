(()=>{
  'use strict';

  const $=selector=>document.querySelector(selector);
  const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];

  function reorderBasketActions(){
    const wrap=$('.basket-action-buttons');
    const extras=$('#extrasBtn');
    const order=$('#orderBtn');
    if(wrap&&extras&&order&&wrap.firstElementChild!==extras)wrap.insertBefore(extras,order);
  }

  function cleanBasketStatus(root=document){
    $$('.basket-row-sub',root).forEach(el=>{
      if((el.textContent||'').trim()==='Quantidade original')el.textContent='';
    });
  }

  function tuneCategoryDialog(dialog){
    if(!dialog||dialog.dataset.visualV5==='1')return;
    const title=dialog.querySelector('.category-head h2');
    if(!title||title.textContent.trim()!=='Escolha as categorias')return;
    dialog.dataset.visualV5='1';
    dialog.classList.add('category-simple');
    title.textContent='O que te interessa?';
    dialog.querySelector('.category-head .eyebrow')?.remove();
    dialog.querySelector('.category-head p')?.remove();
  }

  function syncQuantityControl(card){
    if(!card||card.classList.contains('replacement-card'))return;
    const stepper=card.querySelector('.stepper');
    const input=stepper?.querySelector('input');
    if(!stepper||!input)return;

    let add=card.querySelector('.product-add-button');
    if(!add){
      add=document.createElement('button');
      add.type='button';
      add.className='product-add-button';
      add.textContent='Adicionar';
      add.addEventListener('click',()=>{
        if(add.disabled)return;
        const plus=stepper.querySelector('[data-step="1"]');
        if(!plus||plus.disabled)return;
        card.classList.add('has-quantity');
        add.disabled=true;
        add.textContent='Adicionando…';
        plus.click();
      });
      card.appendChild(add);
    }

    const quantity=Math.max(0,Number(input.value||0));
    const busy=$$('button,input',stepper).some(el=>el.disabled);
    card.classList.toggle('has-quantity',quantity>0||busy&&card.classList.contains('has-quantity'));
    if(!busy){
      add.disabled=false;
      add.textContent='Adicionar';
      card.classList.toggle('has-quantity',quantity>0);
    }

    if(stepper.dataset.visualV5!=='1'){
      stepper.dataset.visualV5='1';
      stepper.addEventListener('change',()=>requestAnimationFrame(()=>syncQuantityControl(card)));
      stepper.addEventListener('click',()=>setTimeout(()=>syncQuantityControl(card),0));
    }
  }

  function tuneProductGrid(root=document){
    $$('.product-card',root).forEach(syncQuantityControl);
  }

  function tuneAll(root=document){
    reorderBasketActions();
    cleanBasketStatus(root);
    $$('.category-modal',root).forEach(tuneCategoryDialog);
    tuneProductGrid(root);
  }

  function boot(){
    tuneAll();
    const observer=new MutationObserver(mutations=>{
      for(const mutation of mutations){
        if(mutation.type==='childList'){
          mutation.addedNodes.forEach(node=>{
            if(node.nodeType!==1)return;
            tuneAll(node);
            if(node.matches?.('.category-modal'))tuneCategoryDialog(node);
            if(node.matches?.('.product-card'))syncQuantityControl(node);
          });
          cleanBasketStatus(mutation.target.nodeType===1?mutation.target:document);
        }
        if(mutation.type==='attributes'){
          const card=mutation.target.closest?.('.product-card');
          if(card)requestAnimationFrame(()=>syncQuantityControl(card));
        }
        if(mutation.type==='characterData')cleanBasketStatus(mutation.target.parentElement||document);
      }
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled']});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
