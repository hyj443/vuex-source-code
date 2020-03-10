// const { default: ModuleCollection } = require("./src/module/module-collection");

const { isObject } = require("./src/util");

// const { default: Module } = require("./src/module/module");

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
      (global = global || self, global.Vuex = factory());
}(this, function () {
  'use strict';
  function isFunc(v) {
    return Object.prototype.toString.call(v) ==='[object Function]'
  }
  function forEach(obj,fn) {
    Object.keys(obj).forEach(key => {
      fn(obj[key], key)
    })
  }
  let Vue

  class Module{
    constructor(options) {
      this._children = Object.create(null)
      this._options = options
      const rawState = options.state
      this.state = (isFunc(rawState) ? rawState() : rawState) || {}
      
    }
    get namespaced() {
      return !!this._options.namespaced
    }
    addChild(key, module) {
      this._children[key]=module
    }
    removeChild(key) {
      delete this._children[key]
    }
    getChild(key) {
      return this._children[key]
    }
    updateModule(options) {
      this._options.namespaced = options.namespaced
      if (options.actions) {
        this._options.actions=options.actions
      }
      if (options.mutations) {
        this._options.mutations=options.mutations
      }
      if (options.getters) {
        this._options.getters=options.getters
      }
    }
    forEachChild(fn) {
      forEach(this._children,fn)
    }
    forEachGetter(fn) {
      if (this._options.getters) {
        forEach(this._options.getters,fn)
      }
    }
    forEachAction(fn) {
      if (this._options.actions) {
        forEach(this._options.actions, fn)
      }
    }
    forEachMutation(fn) {
      if (this._options.mutations) {
        forEach(this._options.mutations, fn)
      }
    }

  }
  class ModuleCollection{
    constructor(rootOptions) {
      this.register(path, rootOptions)
    }
    register(path,options) {
      const newModule = new Module(options)
      if (path.length===0) {
        this.root===0
      } else {
        const parent = this.get(path.slice(0, -1))
        parent.addChild(path[path.length - 1], newModule)
      }
      if (options.modules) {
        forEach(options.modules, (childOptions, key) => {
          this.register(path.concat(key),childOptions)
        })
      }
    }
    unRegister(path) {
      const parent = this.get(path.slice(0, -1))
      const key = path[path.length - 1]
      parent.removeChild(key)
    }

    get(path) {
      return path.reduce((module, key) => {
        return module.getChild(key)
      },this.root)
    }

    getNamespace(path) {
      let module = this.root
      return path.reduce((namespace, key) => {
        module = module.getChild(key)
        return namespace+(module.namespaced?`${key}/`:'')
      },'')
    }
    
  }


  function applyMixin(Vue) {
    Vue.mixin({
      beforeCreate: vuexInit
    })
    function vuexInit() {
      const opts = this.$options
      if (opts.store) {
        this.$store = isFunc(opts.store) ? opts.store() : opts.store
        
      } else if (opts.parent && opts.parent.$store) {
        this.$store = opts.parent.$store
      }
    }
  }

  class Store{
    constructor(options={}) {
      const { plugins = [], strict = false } = options
      this._committing = false
      this._actions = Object.create(null)
      this._mutations = Object.create(null)
      this._wrapedGetters = Object.create(null)
      this._modules = new ModuleCollection(options)
      this._modulesNamespaceMap = Object.create(null)
      this._vm = new Vue()
      this._makeLocalGetterCache = Object.create(null)
      
      const { dispatch, commit } = this
      this.dispatch = (type, payload) => {
        return dispatch.call(this,type,payload)
      }
      this.commit = (type, payload, options) => {
        return commit.call(this,type,payload,options)
      }
      this.strict = strict
      const state = this._modules.root.state
      installModule(this, state, [], this._modules.root)
      resetStoreVM(this, state)
      plugins.forEach((p) =>  p(this) )
      


    }
    _withCommit(fn) {
      const cache = this._committing
      this._committing = true
      fn()
      this._committing=cache
    }
  }


  function installModule(store,rootState,path,module) {
    const isRoot = path.length === 0
    const namespace = store._options.getNamespace(path)
    if (module.namespaced) {
      if (store._modulesNamespaceMap[namespace]) {
        console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
      }
      store._modulesNamespaceMap[namespace]=module
    }
    if (!isRoot) {
      const parentState = getNestedState(rootState, path.slice(0, -1))
      const moduleName = path[path.length - 1]
      store._withCommit(() => {
        Vue.set(parentState,moduleName,module.state)
      })
    }

    const localContext = module.context = makeLocalContext(store, namespace, path)
    
  }

  function makeLocalContext(store,namespace,path) {
    const noNamespace = namespace === ''
    const localContext = {
      dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
        const args = formatUserArgs(_type, _payload, _options)
        let { payload, type, options } = args
        if (!options||!options.root) {
          type = namespace + type
          if (store._actions[type]) {
            console.error('unkown action type')
            return
          }
        }
        return store.dispatch(type,payload)
      },
      commit: noNamespace ? store.commit : (_type, _payload, _options) => {
        const args = formatUserArgs(_type, _payload, _options)
        let { type, payload, options } = args
        if (!options||!options.root) {
          type = namespace + type
          if (!store._mutations[type]) {
            console.error('unkown mutation type')
            return
          }
        }
        store.commit(type,payload,options)
      }
    }
    Object.defineProperties(localContext, {
      getters: {
        get: noNamespace ?
          () => store.getters :
          ()=>makeLocalGetters(store,namespace)
      },
      state: {
        get:()=>getNestedState(store.state,path)
      }
    })
    return localContext
  } 
  function makeLocalGetters(store,namespace) {
    if (store._makeLocalGetterCache[namespace]) {
      return store._makeLocalGetterCache[namespace]
    }
    
  }

  function formatUserArgs(type, payload, options) {
    if (isObject(type)&&type.type) {
      options = payload
      payload = type
      type=type.type
    }
    if (typeof type !=='string') {
      console.error('expects string as the type')
    }
    return {
      type,
      payload,
      options
    }
  }
  function getNestedState(state,path) {
    return path.reduce((state, key) => {
      return state[key]
    },state)
  }
  function install(_Vue) {
    if (Vue && Vue === _Vue) {
      return
    }
    Vue = _Vue
    applyMixin(Vue)
  }


  let output = {
    install,
    Store
  }
  return output

}));