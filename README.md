# 逐行解析Vuex源码

## 回顾一下Vuex是什么

Vuex 是一个专为Vue框架设计的，进行状态管理的库，将共享的数据抽离，放到全局形成一个单一的store，同时利用了Vue内部的响应式机制来进行状态的管理和更新。
![vuex组成](https://vuex.vuejs.org/vuex.png)
Vuex，在全局有一个state存放数据，所有修改state的操作必须通过mutation进行，mutation的同时，提供了订阅者模式供外部插件调用，获取state数据的更新。
所有异步操作都走action，比如调用后端接口异步获取数据，action同样不能直接修改state，要通过若干个mutation来修改state，所以Vuex中数据流是单向的。
state的变化是响应式的，因为Vuex依赖Vue的数据双向绑定，需要new一个Vue对象来实现响应式化。

看源码之前再看一遍[Vuex文档](https://vuex.vuejs.org/zh/)会加深理解，建议抽空过一遍。

## Vuex的安装

在一个模块化的打包系统中，在使用Vuex前，你必须通过 Vue.use() 来安装 Vuex：

```js
import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(vuex);
```
有关 `Vue.use()` ，Vue.js 文档原话是：
>Vue.use(plugin)
>安装 Vue.js 插件。如果plugin是一个对象，它必须提供 install 方法。如果plugin是一个函数，则它被作为 install 方法。
>Vue.use 需要在调用 new Vue() 之前被调用。

我们不妨看看 `Vue` 源码中 `Vue.use` 的实现，看看是如何它调用插件的 `install`

```js
function initUse (Vue) {
  Vue.use = function (plugin) {
    var installedPlugins = (this._installedPlugins || (this._installedPlugins = []));
    if (installedPlugins.indexOf(plugin) > -1) { 
      return this // 注册过此插件，直接返回 Vue 本身
    }
    var args = toArray(arguments, 1); 
    // 从索引1开始，参数类数组转成数组
    args.unshift(this); // args数组的第一项是Vue
    if (typeof plugin.install === 'function') {
      plugin.install.apply(plugin, args); 
    // 调用install，把Vue作为第一个参数传入
    } else if (typeof plugin === 'function') {
      plugin.apply(null, args);
    }
    installedPlugins.push(plugin); // 注册过的plugin
    return this
  };
}
```
我们看到，Vue.use执行时，会调用 install，install 可以接收不止一个参数，但第一个是 Vue 对象。

我们看到 Vuex 的入口文件，在src\index.js。

```js
export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers
}
```
Vuex 整体导出的对象有 install 方法，接下来我们看 `install` 方法到底做了什么。

```js
let Vue
// ....
function install (_Vue) {
  if (Vue && _Vue === Vue) { //避免重复安装 Vuex
      console.error('[vuex] already installed. Vue.use(Vuex) should be called only once.');
    return
  }
  Vue = _Vue; // 保存传入的Vue对象
  applyMixin(Vue);
}
```

你可以看到，install 函数做了两件事：

1. 避免Vuex重复安装: 如果定义的 Vue 有值，并且 === 传入的 Vue 对象，意味着已经install过，本地的Vue已经保存了Vue实例对象，可以供别处使用，所以直接返回
2. 调用 applyMixin(Vue) 做了真正的 install 安装工作

我们看看 applyMixin 的实现：

```js
function applyMixin (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // Vue 1.x 的处理，不做分析
  }
  function vuexInit () {
    // ...
  }
}
```
在 applyMixin 中，先判断Vue的版本，1.x版本我们不做分析，2.x的版本，调用 Vue.mixin。Vue.mixin的作用是：全局注册一个混入，会影响注册之后创建的每个 Vue 实例。

由此可知，applyMixin 执行后，之后创建的每个 Vue 实例的生命周期走到beforeCreate时，都会调用函数 vuexInit

那vuexInit做了什么？顾名思义，就是 vuex 的初始化。看看它的实现：

```js
function vuexInit () {
  var options = this.$options;
  // store 注入
  if (options.store) {
    this.$store = typeof options.store === 'function'
      ? options.store()
      : options.store;
  } else if (options.parent && options.parent.$store) {
    this.$store = options.parent.$store;
  }
}
```
vuexInit执行时，this 指向 当前 Vue 实例，所以this.$options就是当前 Vue 实例的初始化选项，this.$options.store就是我们传入new Vue的options对象中的store对象，如下：
```js
new Vue({
  store,
  router,
  render: h => h(App)
}).$mount('#app')
```
回到vuexInit函数，注意到if else判断，如果options.store存在，说明当前是根Vue实例，那么，我们把store对象赋给 Vue实例的$store属性；如果不是根Vue实例，再判断，是否有父组件并且父组件是否有$store，如果有，当前子组件也添加一个$store属性，属性值为父组件的$store，即options.parent.$store

因此，每个 Vue 组件的创建，执行 beforeCreate 钩子时会调用 vuexInit ：将 `new Vue()` 时传入的 `store` 对象保存到根实例的 `$store`，再赋给它下面的子组件实例的 `$store`，最后，所有创建了的组件实例都有`$store`，值都指向了同一个 `store` 对象。

这种子组件从父组件中拿的注入机制，使得之后创建的每一个Vue实例都能访问到根实例中注册的store对象。

## 怎么理解 store 对象

由前面分析可知，install中调用了applyMixin，applyMixin中调用了 Vue.mixin ，在beforeCreate中调用vuexInit，进行 store 对象的注入。

那么，我们给实例化 Vue 所传入的 store 对象是怎么来的？

```js
const store = new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules
})
```
store 是通过 `new Vuex.Store()` 返回出的Store实例，Store 这个构造函数，new执行时接收一个options对象，包含actions、getters、state、mutations、modules等。

接下来我们看看 Store 这个构造函数。

## 探究 Store

先看看 `constructor` ，即构造函数本身。代码较长，我们拆分成几段来看：

```js
class Store {
  constructor(options = {}) {
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }
    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }
    // ……
  }
  // ……
}
```

首先作判断，如果 Vue 没有值，说明没有调用过install，如果当前是在浏览器环境，且 window 上有 Vue，就传入 window.Vue 执行 install 方法，进行安装。

然后是执行3个assert函数，作判断

1. 确保Vue有值，也就是实例化 Store 之前必须install过，因为后面会用到Vue的一些api
2. 确保Promise能用，Vuex 依赖 promise ，后面会讲到；
3. Store 里的 this 必须是 Store 的实例，也就是 Store 必须用 new 字符调用

接着开始挂载一些实例属性，代表store实例的内部状态：

```js
  const { plugins = [], strict = false} = options

  this._committing = false // 提交mutation状态的标志
  this._actions = Object.create(null) // 存放actions
  this._actionSubscribers = [] // action 订阅函数集合
  this._mutations = Object.create(null) // 存放mutations
  this._wrappedGetters = Object.create(null) // 存放getters
  this._modules = new ModuleCollection(options) // module收集器
  this._modulesNamespaceMap = Object.create(null) // 模块命名空间
  this._subscribers = [] // 存储所有对mutation变化的订阅者
  this._watcherVM = new Vue() // Vue实例，用它的$watch来观测变化
```

我们不用管具体每个代表什么含义，后面会明白的。

初始化的重点是 `this._modules = new ModuleCollection(options)`，稍后会详细介绍。接下来继续看完 Store 的 constructor ：

```js
  const store = this
  const { dispatch, commit } = this
  this.dispatch = function boundDispatch(type, payload) {
    return dispatch.call(store, type, payload)
  }
  this.commit = function boundCommit(type, payload, options) {
    return commit.call(store, type, payload, options)
  }
```

首先让store变量指向this，即store实例。再从 this 解构出 Store 的原型上的 dispatch 、commit 方法，给 store实例添加dispatch和commit方法，方法执行分别返回 dispatch 和 commit 两个原型方法的 call 调用，将执行时的 this 指向当前 store 实例。

现在 store 实例对象上就有了 dispatch 和 commit 两个方法，他们的具体实现后面会讲。

接着看 constructor

```js
  this.strict = strict
  const state = this._modules.root.state
  installModule(this, state, [], this._modules.root)
  resetStoreVM(this, state)
  plugins.forEach(plugin => plugin(this))
  // ...省略
```

现在到了 Vuex 初始化的核心部分了，包括了：

1. 拿到options中的strict值
2. state 拿到 根 state 对象
3. installModule：模块的注册
4. resetStoreVM：state的响应式化处理
5. 插件的注册

目前为止，constructor 的代码已快速地过了一遍。总结一下，Store 函数主要做了三件事：

1. 初始化一些内部属性，其中重点是初始化 _module 属性
2. 执行installModule，安装模块
3. 执行resetStoreVM ，使store响应式化

我们将逐个细说这三个，先说初始化 _module 属性，也就是 module 的收集：

```js
this._modules = new ModuleCollection(options)
```
### Module 收集

Vuex文档的原话这么说：
> store 使用单一的状态树，用一个对象就包含了全部的应用层级的状态，每个应用将仅仅包含一个 store 实例。

如果应用变得很复杂，store 对象就可能很臃肿。为了解决这个问题，Vuex引入了模块化，Vuex 允许我们将 store 切割成 module，每个模块都有自己的 state 、mutation、action、getter、甚至子模块，像下面这样从上至下进行分割：

```js
const moduleA = {
  state: { ... },
  mutations: { ... },
  actions: { ... },
  getters: { ... }
}
const moduleB = {
  state: { ... },
  mutations: { ... },
  actions: { ... }
}
const store = new Vuex.Store({
  modules: {
    a: moduleA,
    b: moduleB
  }
})
store.state.a // -> moduleA 的状态
store.state.b // -> moduleB 的状态
```

可以看到，module 的设计是一个树形结构，store 本身可以理解为一个根 module，下面是一些子 module
`this._modules = new ModuleCollection(options)`
这句做的就是：从 options 配置对象的这种树形关系，转成用父子关系联系的一个个对象，也就是进行 module 的收集

那么 `ModuleCollection` 这个构造函数 做了什么？

```js
class ModuleCollection {
  constructor (rawRootModule) {
    this.register([], rawRootModule, false)
  }
  get (path) {...}
  getNamespace (path) {...}
  update (rawRootModule) {...}
  register (path, rawModule, runtime = true) {
    // 省略，后面会展开讲
  }
  unregister (path) {...}
}
```
我们发现，new ModuleCollection时，就是执行原型方法 register，`this.register([], rawRootModule, false)`

我们看看 register 这个函数：

```js
register (path, rawModule, runtime = true) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, rawModule)
  }
  const newModule = new Module(rawModule, runtime)
  if (path.length === 0) { // 如果path是空数组，说明是 根 模块
    this.root = newModule
  } else {
    const parent = this.get(path.slice(0, -1))
    parent.addChild(path[path.length - 1], newModule)
  }
  // register 嵌套的子模块
  if (rawModule.modules) {
    forEachValue(rawModule.modules, (rawChildModule, key) => {
      this.register(path.concat(key), rawChildModule, runtime)
    })
  }
}
```

register 方法，顾名思义，作用是 module 的注册，它接收 3 个参数：

1. path：module的路径。我们拆分module时，module的key组成的数组，比如前面的例子中，moduleA 的 path 是 ['a'] ， moduleB 的 path 是 ['b'] ，如果他们还有子模块，则子模块的 path 就大致形如 ['a','a1'] 、['a','a2'] 、['b','b1']
2. rawModule，是定义当前 module 的配置对象，可以理解为当前module对应的未经加工的配置对象，像 rawRootModule 就是实例化 Store 时传入的 options。
3. runtime 表示是否是一个运行时创建的 module，默认为 true。

好，那实例化 ModuleCollection 上来就执行 register 

```js
this.register([], rawRootModule, false)
```

第一个参数传入的是空数组，代表这是 根module 的路径。rawRootModule 是 new Vuex.Store时传入的options对象。所以这是在注册根 module。

我们具体看看register的内部：

```js
if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, rawModule)
}
```

先调用 assertRawModule 对 module 作一些判断，遍历 module 内部的 getters、mutations、actions 是否符合要求，这里不作具体分析。

```js
const newModule = new Module(rawModule, runtime)
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

然后根据 当前的rawModule配置对象，创建一个 module 对象 newModule，我们稍后会分析Module构造函数。

如果 path 不是空数组，进入else部分，后面会分析，我们先从 根module 的注册开始讲起。
如果 path 为空数组，说明是当前注册的是根 module，我们把 newModule 保存到 this.root，因此 this._modules.root 即 store._modules.root 就能取到 根配置对象 options。

```js
if (rawModule.modules) {
  forEachValue(rawModule.modules, (rawChildModule, key) => {
    this.register(path.concat(key), rawChildModule, runtime)
  })
}
```
我们知道 module 可以嵌套自己的子模块，注册当前模块的同时，也要对子模块进行注册。

因此 if 判断传入的 rawModule 是否有 modules，即当前module是否有嵌套的子module，如果有，则遍历 modules 里的每个键值对，逐个执行回调函数，在回调函数中调用register函数，对子模块进行注册。

注意到的是，传入register的path的，`path.concat(key)` 是将当前遍历的key追加到 当前 path 数组末尾，代表了当前子模块的路径，因为我们提到，模块a嵌套了模块b，b模块嵌套了模块c，那模块c的path就是 ['a','b','c']

传入register的第二个参数rawChildModule，是当前遍历的value值（即子模块的配置对象）

我们快速看一眼 forEachValue 这个辅助函数：

```js
forEachValue (obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}
```

遍历对象中的 key，对每个键值对对执行fn，注意参数 属性值 在前。

所以，注册完根 module后，如果还有第二次调用 register，那此时的module就是它的子模块了，进入 else 语句块:

```js
 const parent = this.get(path.slice(0, -1))
 parent.addChild(path[path.length - 1], newModule)
```
path是当前子模块的路径，那 path.slice(0, -1) 是什么，它获取的是当前path数组的去掉最后一项的新数组，它是当前模块的父亲模块的path。

传入get方法执行，目的是为了拿到该当前子模块的父module对象，我们看看get做了什么：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

这里不再赘述 reduce 的用法，具体可以参考 [MDN:reduce](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/Reduce)的解释。

get方法是 ModuleCollection 的原型方法，我们先快速看一眼 getChild 和 addChild 的实现，再回来理解get。

```js
getChild (key) {
  return this._children[key]
}
addChild (key, module) {
  this._children[key] = module
}
```
它们是Module构造函数的原型方法，getChild方法是根据key获取当前模块的子模块对象，addChild是给当前模块添加子模块对象。可以看出这种父子关系的维系是靠_children属性。

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```
我们回到get方法。我们假设一种情况，传入的 path 为 ['a','b','c']

reduce 累加器的初始值为 this.root，是根module对象，第一次迭代执行回调返回的是：根模块下的key为'a'的子模块，并且该值作为下一次迭代的累加器的值，即回调函数中的第一个参数module，第二次迭代执行又返回：'a'模块下的子模块'b'对象，以此类推，最后拿到 path 为 ['a','b','c'] 对应的模块，而它是当前模块的父模块 parent。

因此get函数，通过reduce方法一层层解析去找到对应的父模块。

我们拿到当前模块的父模块对象后，执行这句：

```js
parent.addChild(path[path.length - 1], newModule)
```

给父模块对象的_children属性，添加子模块对象，key 为 path数组最后一项，作为当前模块名，val 为 当前模块对象。

这其实通过 _children 属性，建立了父模块对象和子模块对象之间的父子关系，而且这种联系是基于 Module 实例的层面的，不是raw的options层面的父子关系。我们后面会具体谈 Module 这个类，它的实例化会初始化_children这个属性。

我们再整体看一遍 register方法：

```js
register (path, rawModule, runtime = true) {
  //  
  const newModule = new Module(rawModule, runtime)
  if (path.length === 0) { // 如果path是空数组，说明是 根 模块
    this.root = newModule
  } else {
    const parent = this.get(path.slice(0, -1))
    parent.addChild(path[path.length - 1], newModule)
  }
  if (rawModule.modules) {
    forEachValue(rawModule.modules, (rawChildModule, key) => {
      this.register(path.concat(key), rawChildModule, runtime)
    })
  }
}
```

你可以发现，register函数肯定至少会执行一次，也就是，根module一定会注册的，然后只要你有子模块存在，register会被递归调用，去注册每一个子模块，并且保证每一个子模块都通过 path 去找到自己的父模块对象，然后通过 addChild 建立父子关系，然后再看当前子模块还有没有自己的子模块，递归下去，拉起了整个 module 树结构。

我们讲了那么多，其实都是围绕 newModule 这个 Module的实例，接下来要看看Module构造函数
```js
const newModule = new Module(rawModule, runtime)
```

## Module 构造函数

我们刚刚已经能感受出，Vuex 的设计者将用户定义的 module 配置称为 rawModule ，因为它是一个未经加工的配置对象，传入new Moudle 调用之后，才实现了从 rawModule 到 newModule 的转变。

```js
class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    this._children = Object.create(null)
    this._rawModule = rawModule
    const rawState = rawModule.state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }
  // ...原型方法暂时省略
}
```

我们先看 constructor，它先对传入的一些值做保存。
this._children 对象存放当前模块对象的子模块对象，
this._rawModule 保存 当前模块的raw配置对象
this.state 存放该模块的 state 。

此外，Module 提供了很多原型方法，我们暂时不作一一介绍。

### 回顾 module 收集过程

现在我们回过头，梳理整个 new ModuleCollection 的过程（也就是register的执行）。包含了两件事：

1. 由 rawModule 配置对象 构建出 module 对象 （new Module）
2. 通过递归调用 register，建立父子 module 之间的父子联系

也就是 new Module 是在  new ModuleCollection 的过程中发生的，你要先生成了模块对象，才会进行模块对象的收集不是。

### installModule

我们在讲 Store 的 constructor 时，讲了它重点的做的三件事，现在我们讲完了 模块的收集，接着就是模块的安装，也就是 constructor 中的这句：

```js
installModule(this, state, [], this._modules.root)
```

我们肯定要看installModule的实现：

```js
function installModule(store, rootState, path, module, hot) {
  const isRoot = !path.length // 是否为根module
  const namespace = store._modules.getNamespace(path) // 获取module的namespace
  // register in namespace map
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }
  // set state
  if (!isRoot && !hot) { // 不为根且非热更新
    const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级的state
    const moduleName = path[path.length - 1] // module的name
    store._withCommit(() => { // 将子module设置成响应式的
      Vue.set(parentState, moduleName, module.state)
    })
  }
  const local = module.context = makeLocalContext(store, namespace, path)
  module.forEachMutation((mutation, key) => {...}) // 遍历注册mutation
  module.forEachAction((action, key) => {...}) // 遍历注册action
  module.forEachGetter((getter, key) => {...})// 遍历注册getter
  module.forEachChild((child, key) => { // 递归安装module
    installModule(store, rootState, path.concat(key), child, hot)
  })
}
```
由Vuex文档可知：

Vuex 2后的版本添加了命名空间的功能，使用了module后，state就被模块化，比如要调用根模块的state，则`store.state.xxx`，如果要调用a模块的state，则调用`store.state.a.xxx`。

但默认情况下，模块内部的 action、mutation 和 getter 是注册在全局命名空间的，比如，不同模块有同名的mutation，会导致多个模块能够对同一个 mutation 作出响应。

如果希望你的模块具有更高的封装度和复用性，你可以通过添加 namespaced: true 的方式使其成为带命名空间的模块。当模块被注册后，它的所有 getter、action 及 mutation 都会自动根据模块注册的路径调整命名。例如：

```js
const store = new Vuex.Store({
  modules: {
    account: {
      namespaced: true,
      state: {}, 
      getters: {
        isAdmin() {...} // -> getters['account/isAdmin']
      },
      actions: {
        login() {...} // -> dispatch('account/login')
      },
      mutations: {
        login() {...} // -> commit('account/login')
      },
      modules: { // 继承父模块的命名空间
        myPage: {
          state: {},
          getters: {
            profile() {...} // -> getters['account/profile']
          }
        },
        posts: {
          namespaced: true,// 进一步嵌套命名空间
          state: {},
          getters: {
            popular() {...} // -> getters['account/posts/popular']
          }
        }
      }
    }
  }
})
```

我们先看 installModule 它接收什么参数：

```js
// installModule(this, state, [], this._modules.root)
function installModule(store, rootState, path, module, hot) {
    // 
}
```
store 是 Store实例，是唯一的，就是我们 new Vuex.Store的那个store对象
rootState 是 根state对象
path 是 当前的模块对应的路径
module 是当前模块对象
hot 代表是否支持热重载（这里不讨论它）

installModule 代码较长，我们分段来看

```js
const isRoot = !path.length
const namespace = store._modules.getNamespace(path)
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```

首先，根据path的长度判断是否为根module
接着，根据path 调用 getNamespace 方法，拿到当前 module的namespace
```js
getNamespace (path) {
  let module = this.root
  return path.reduce((namespace, key) => {
    module = module.getChild(key)
    return namespace + (module.namespaced ? key + '/' : '')
  }, '')
}
```
getNamespace 是 ModuleCollection 构造函数的原型方法。这里同样用的reduce方法，先拿到根module对象，再沿着path，拿到子模块对象，查看子模块对象上的namespaced，如果为真，就将上一次执行回调的返回值拼接上当前的key字符串，否则拼接''，累加器初始值为''

这样就拿到了 当前模块的 namespace
接下来，`store._modulesNamespaceMap[namespace] = module` store对象上的实例属性_modulesNamespaceMap，是一个对象，存放模块命名空间，现在做的就是写入键值对，将
namespace 对应的 模块写入。

```js
// set state
if (!isRoot && !hot) { // 不为根且非热更新
  const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级的state
  const moduleName = path[path.length - 1] // module的name
  store._withCommit(() => { // 将子module设置成响应式的
    Vue.set(parentState, moduleName, module.state)
  })
}
```
这段代码是干嘛呢？
首先，根据根state和path.slice(0, -1)获取父模块的state
我们快速看一看 getNestedState

```js
  function getNestedState (state, path) {
    return path.length
      ? path.reduce((state, key) => state[key], state)
      : state
  }
```
我们再次看到reduce的应用，根据根state，沿着path路径，一个个往下获取，直到获取到当前state的父state。就比如`store.state` >> `store.state.a` >> `store.state.a.b`...

` const moduleName = path[path.length - 1]` 获取到当前 模块的key名，即模块名
```js
  store._withCommit(() => { 
    Vue.set(parentState, moduleName, module.state)
  })
```
调用了Store的原型方法，我们看看它的实现：

```js
  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
```
_committing 代表提交mutation的标志位，_withCommit接收一个函数fn，先把_committing置为true，代表提交mutation中，然后执行fn，再把 _committing 这个标志位恢复到原来的值。
所以store._withCommit执行，执行的是`Vue.set(parentState, moduleName, module.state)`
也就是说，Vue.set执行时，我期望_committing这个标志位是true，此时我不希望有mutation执行。（我暂时这么理解，不太确定）

至于 Vue.set本身，我们是利用Vue暴露的api，将根state上的子state也响应式化。

接下来，注册 mutation 等

```js
const local = module.context = makeLocalContext(store, namespace, path)
  
module.forEachMutation((mutation, key) => {
  const namespacedType = namespace + key
  registerMutation(store, namespacedType, mutation, local)
})
```
执行makeLocalContext方法，为当前模块设置局部化的 dispatch、commit方法，和 getters、state 属性，把返回的local对象赋给 local 和 module.context

然后调用Module的原型方法 forEachMutation，将回调函数传入执行
```js
forEachMutation (fn) {
  if (this._rawModule.mutations) {
    forEachValue(this._rawModule.mutations, fn)
  }
}
```
forEachMutation 中，判断当前模块对应的配置对象，即_rawModule，是否传了 mutations，如果传了，就调用forEachValue，遍历mutations，对mutations的键值对执行fn

我们看传入的fn：
```js
(mutation, key) => {
  const namespacedType = namespace + key
  registerMutation(store, namespacedType, mutation, local)
}
```
namespacedType 拿到了 当前遍历的mutation的namespace字符串拼接上，它自己的key（mutation名称）

然后开始 调用 registerMutation 进行 mutation 方法的注册，我们看看registerMutation函数的实现：

```js
  function registerMutation (store, type, handler, local) {
    var entry = store._mutations[type] || (store._mutations[type] = []);
    entry.push(function wrappedMutationHandler (payload) {
      handler.call(store, local.state, payload);
    });
  }
```
首先明确4个参数分别是什么：
store：唯一的store实例对象
type ：即namespacedType，即commit('account/login') 引号里的字符串就是type
handler：是mutation的属性值，即mutation方法本身
local ：这个对象存放了 给当前模块设置的 局部化的 dispatch、commit方法，和 getters、state 属性

` var entry = store._mutations[type] || (store._mutations[type] = []);`

我们知道store的实例属性_mutations，是个对象，它是存放mutation的，如果store._mutations[type]不存在，那就把一个空数组赋给 store._mutations[type]，它专门用来存放type对应的mutation。注意 这里store._mutations[type]和entry指向同一个内存空间

```js
entry.push(function wrappedMutationHandler (payload) {
  handler.call(store, local.state, payload);
});
```
当前遍历的mutation 它对应的 store._mutations[type] 数组推入一个wrappedMutationHandler函数，它的执行就是handler的call调用执行，把执行时的this指向store对象，还接收一个local.state，即局部化的state, 和wrappedMutationHandler传来的 payload。

接着，是action的注册
```js
module.forEachAction((action, key) => {
  const type = action.root ? key : namespace + key
  const handler = action.handler || action
  registerAction(store, type, handler, local)
})
```
我们 forEachAction 的实现可知：如果当前模块对应的配置对象，写了actions，那就遍历actions，执行回调函数，传入action和对应的key，如果开发者想在带命名空间的模块注册全局 action，他会在action配置对象中添加 root: true，并将这个 action 的定义放在 handler 中。
所以 取type时要做一个判断，root为真，则直接取key字符串，否则还是命名空间拼接key
然后 handler 优先取 action对象中的handler，没有则说明不是写成对象形式，直接取action。然后调用registerAction进行action的注册。
```js
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {return res}
  })
}
```
首先 entry 先指向store._actions（专门存放actions的数组）
然后entry数组推入一个包裹的Aciton处理函数，即wrappedActionHandler
我们看看wrappedActionHandler具体做了哪些事：
首先 缓存handler的调用结果，赋给res，handler执行时的this指向stor，handler 函数接受一个与 store 实例具有相同方法和属性的 context 对象，和 wrappedActionHandler传入的payload和回调cb
执行结果赋给res，缓存起来
然后判断res是否是promise实例，如果不是，就用 Promise.resolve(res)进行包裹成resolve值为res的promise实例。最后返回res，（不考虑使用了devtools的情况）

接着，注册getter
```js
module.forEachGetter((getter, key) => {
  const namespacedType = namespace + key
  registerGetter(store, namespacedType, getter, local)
})
```
直接看 registerGetter
```js
 function registerGetter (store, type, rawGetter, local) {
    if (store._wrappedGetters[type]) {
      console.error(("[vuex] duplicate getter key: " + type));
      return
    }
    store._wrappedGetters[type] = function wrappedGetter (store) {
      return rawGetter(
        local.state, // local state
        local.getters, // local getters
        store.state, // root state
        store.getters // root getters
      )
    };
  }
```
首先是if判断，如果_wrappedGetters，一个对象，type对应的getter已经存在，就报错提示：你这个getter的key命名重复了，然后直接返回。
不存在，那就往里面写入属性type和对应的属性值：wrappedGetter方法
wrappedGetter方法返回rawGetter的执行结果，rawGetter即你之前遍历getters时，传入回调的getter值。rawGetter执行传入的是local对象的state/、getters等

mutation action getter都注册完了，到了installModule的最后一步，遍历当前模块的子模块，进行模块的安装：
```js
module.forEachChild((child, key) => {
  installModule(store, rootState, path.concat(key), child, hot)
})
forEachChild (fn) {
  forEachValue(this._children, fn)
}
```
当前模块的_children，它存放着它的子模块们，遍历它们，执行fn，递归调用installModule去安装子模块，注意第三个参数path，是当前path追加一个key，也就是子模块的path。这样，子模块也得到了安装，也就是子模块的mutations actions等方法得到了注册。

## resetStoreVM

好了，我们现在来到 Store 构造函数所做的核心的三件事的最后一件：响应式化state
Vuex文档的原话：
>Vuex 的状态存储是响应式的。当 Vue 组件从 store 中读取 state 时，若 store 中的 state 发生变化，那么相应的组件也会相应地得到更新。

那Vuex是如何把state对象转成响应式的数据呢？原因在下面这句：
```js
resetStoreVM(this, state)
```

传入的this是store对象，state是根state，执行resetStoreVM
我们看看 resetStoreVM 的实现（代码做了一些省略）：
```js
  function resetStoreVM (store, state, hot) {
    const oldVm = store._vm
    store.getters = {}
    const wrappedGetters = store._wrappedGetters
    const computed = {}
    forEachValue(wrappedGetters, (fn, key) => {
      computed[key] = () => {
        return fn(store)
      }
      Object.defineProperty(store.getters, key, {
        get: () => store._vm[key],
        enumerable: true // for local getters
      })
    })
    store._vm = new Vue({
      data: {
        $$state: state
      },
      computed
    })
    // ...
  }
```
先用oldVm保存store._vm，因为后面store._vm要更新，保存一份旧值。
store对象上挂载一个getters属性，值为一个空对象。定义wrappedGetters，指向store._wrappedGetters，里面存放的是wrappedGetter。定义一个computed对象。
遍历wrappedGetters对象，给computed对象添加getter方法，注意fn，即getter函数，包裹了一层函数，也就是这个getter在函数外部执行，也能通过闭包引用了函数作用域中的store这个私有形参，这个store不会随着resetStoreVM执行结束而销毁。
然后，通过Object.defineProperty在store.getters添加一个getter属性，读取它的值时会执行它的get函数，返回store._vm[key]
这样的话，我们在组件中调用this.$store.getter.xxx，就等同于访问 store._vm.xxx

store._vm上为什么会有xxx属性呢，原因是接下来
```js
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
```
实例化Vue，传入的data中传入$$state: state，这样$$state就成了响应式属性，state会被深度观测，也就是state对象中的属性也被转成响应式属性，并且store._vm会代理store._vm._data.$$state中的属性，访问store._vm.$$state就相当于访问store._vm._data.$$state。

我们知道Store构造函数有state这个原型属性
```js
 get state () {
     return this._vm._data.$$state
 }
```
现在访问 this.$store.state.xxx，触发了这个get函数，返回的是this.$store._vm._data.$$state.xxx


现在的computed对象就存了getters，把它当作computed选项传入Vue构造函数后，也进行了响应式化，当你访问store.getters.xxx 这个getter函数时，会返回 store._vm.xxx，为什么_vm实例会有getter呢，因为你把它注册为computed了，可以通过Vue实例，即_vm 访问到了


